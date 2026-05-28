(function(){
    const VERSION = '2026.05.25.3';
    const scripts = [
        '/infinite-canvas/js/i18n-core.js',
        '/infinite-canvas/js/i18n/common.js',
        '/infinite-canvas/js/i18n/studio.js',
        '/infinite-canvas/js/i18n/api-settings.js',
        '/infinite-canvas/js/i18n/canvas.js',
        '/infinite-canvas/js/i18n/smart-canvas.js',
        '/infinite-canvas/js/i18n/comfyui-settings.js',
    ];
    const tags = scripts.map(src => '<script src="' + src + '?v=' + VERSION + '"></script>').join('');
    if(document.readyState === 'loading' && document.currentScript){
        document.write(tags);
        return;
    }
    scripts.reduce((promise, src) => promise.then(() => new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = src + '?v=' + VERSION;
        script.onload = resolve;
        script.onerror = reject;
        document.head.appendChild(script);
    })), Promise.resolve()).then(() => window.StudioI18n?.apply?.()).catch(err => console.error('Failed to load i18n modules', err));
})();
