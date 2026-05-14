(function() {
    if (window.hasCaptchaXInjected) return;
    window.hasCaptchaXInjected = true;

    function fillCaptchaResult(text, captchaElement, retryCount = 0) {
        if (!captchaElement || !text) return;

        const container = captchaElement.closest('form, .qbd_register_item_con, .login-box, div[class*="login"]') || 
                          captchaElement.parentElement.parentElement || 
                          document.body;

        const inputs = Array.from(container.querySelectorAll('input:not([type="hidden"]):not([type="checkbox"]):not([type="radio"])'))
                            .filter(input => {
                                const style = window.getComputedStyle(input);
                                return style.display !== 'none' && style.visibility !== 'hidden';
                            });

        let targetInput = null;
        let bestScore = -1;

        inputs.forEach(input => {
            const id = (input.id || '').toLowerCase();
            const name = (input.name || '').toLowerCase();
            const placeholder = (input.placeholder || '').toLowerCase();
            const className = (input.className || '').toLowerCase();
            const combinedAttr = `${id} ${name} ${placeholder} ${className}`;

            const excludeKeywords = ['user', 'name', 'phone', 'mobile', 'mail', 'search', 'password', 'pass', 'pwd'];
            if (excludeKeywords.some(key => combinedAttr.includes(key) && !combinedAttr.includes('verify'))) {
                return;
            }

            let score = 0;
            if (combinedAttr.includes('verify') || combinedAttr.includes('cap') || combinedAttr.includes('code') || combinedAttr.includes('yzm')) {
                score += 100;
            }
            
            const imgRect = captchaElement.getBoundingClientRect();
            const inputRect = input.getBoundingClientRect();
            const distance = Math.sqrt(Math.pow(imgRect.left - inputRect.left, 2) + Math.pow(imgRect.top - inputRect.top, 2));
            score += (1000 - Math.min(distance, 1000)) / 10;

            if (input.maxLength > 0 && input.maxLength <= 6) score += 20;

            if (score > bestScore) {
                bestScore = score;
                targetInput = input;
            }
        });

        if (targetInput) {
            targetInput.focus();
            targetInput.value = text;
            
            ['input', 'change', 'blur'].forEach(name => {
                targetInput.dispatchEvent(new Event(name, { bubbles: true }));
            });

            if (typeof jQuery !== 'undefined') {
                const $input = jQuery(targetInput);
                $input.val(text).trigger('change').trigger('input');
            }
            console.log('[CaptchaX] 验证码填充成功');
        } else {
            if (retryCount < 5) {
                setTimeout(() => fillCaptchaResult(text, captchaElement, retryCount + 1), 500);
            }
        }
    }

    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
        if (message.type === 'CAPTCHA_RESULT') {
            if (message.result && !message.result.ignored) {
                const captchaImg = findCaptchaImage(message.captchaIndex);
                if (captchaImg) {
                    fillCaptchaResult(message.result.text, captchaImg);
                } else {
                    console.warn('[CaptchaX] 收到识别结果，但原图片元素已丢失。');
                }
            }
        }
        
        if (message.type === 'TRIGGER_DETECT_AND_RECOGNIZE') {
            detectAndSendCaptcha();
        }
    });

    function findCaptchaImage(index) {
        return document.querySelector(`[data-captcha-id="${index}"]`);
    }

    function detectAndSendCaptcha() {
        const images = document.querySelectorAll('img, canvas');
        images.forEach(img => {
            if (img.offsetParent === null) return; 
            const style = window.getComputedStyle(img);
            if (style.display === 'none' || style.visibility === 'hidden') return;

            const src = img.src || '';
            const isCaptcha = /captcha|verify|yzm|code/i.test(src) || 
                              (img.width >= 30 && img.width <= 150 && img.height >= 20 && img.height <= 60);

            if (isCaptcha) {
                if (!img.dataset.captchaId) {
                    img.dataset.captchaId = 'captcha_' + Date.now() + '_' + Math.floor(Math.random() * 1000);
                }
                const captchaId = img.dataset.captchaId;

                getBase64(img).then(base64 => {
                    chrome.runtime.sendMessage({
                        type: 'RECOGNIZE_CAPTCHA',
                        imageBase64: base64,
                        captchaIndex: captchaId
                    });
                }).catch(() => {});
            }
        });
    }

    // 【核心调优】：优先本地 Canvas 静默提取，彻底避免触发二次 GET 请求刷新验证码
    function getBase64(img) {
        return new Promise(async (resolve, reject) => {
            if (img.src && img.src.startsWith('data:image')) {
                return resolve(img.src);
            }

            // 1. 优先尝试原生 Canvas 提取（静默截取当前画面像素，绝对不触发网络请求）
            try {
                const canvas = document.createElement('canvas');
                // 使用 naturalWidth 保证绘制清晰度
                canvas.width = img.naturalWidth || img.width;
                canvas.height = img.naturalHeight || img.height;
                const ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0);
                const base64Data = canvas.toDataURL('image/png');
                return resolve(base64Data);
            } catch (canvasError) {
                // 2. 只有在此处捕获到 SecurityError（真跨域）时，才启动 Fetch 强制重载模式
                console.warn('[CaptchaX] 图片跨域受限，降级启用 Fetch 模式 (可能会刷新该图片):', img.src);
                try {
                    const response = await fetch(img.src, {
                        method: 'GET',
                        credentials: 'include' 
                    });

                    if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);

                    const blob = await response.blob();
                    const reader = new FileReader();

                    reader.onloadend = () => {
                        const base64Data = reader.result;
                        img.src = base64Data; 
                        resolve(base64Data);
                    };
                    
                    reader.onerror = () => reject(new Error('FileReader Error'));
                    reader.readAsDataURL(blob);
                } catch (fetchError) {
                    reject(fetchError);
                }
            }
        });
    }

    setTimeout(detectAndSendCaptcha, 2000);
})();