// background.js
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.type === 'GET_CSRF') {
        chrome.cookies.get({ url: "https://www.bilibili.com", name: "bili_jct" }, (cookie) => {
            sendResponse({ token: cookie ? cookie.value : null });
        });
        return true; // 保持消息通道开启
    }
});