(function() {
    'use strict';

    // === 配置 ===
    const POLL_INTERVAL = 1500; 
    const REQUEST_DELAY = 1000; 

    let selectedUsers = new Map();
    let isProcessing = false; 

    // 获取 Token
    function getCsrfTokenFromBackground() {
        return new Promise((resolve) => {
            try {
                chrome.runtime.sendMessage({ type: 'GET_CSRF' }, (response) => {
                    if (chrome.runtime.lastError) resolve(null);
                    else resolve(response && response.token ? response.token : null);
                });
            } catch (e) { resolve(null); }
        });
    }

    // UI
function ensurePanel() {
    let panel = document.getElementById('bili-batch-block-panel');
    if (panel) return panel;
    
    // 创建触发按钮
    let trigger = document.getElementById('bili-block-trigger');
    if (!trigger) {
        trigger = document.createElement('div');
        trigger.id = 'bili-block-trigger';
        trigger.innerText = 'B';
        document.body.appendChild(trigger);
    }
    
    // 创建面板
    panel = document.createElement('div');
    panel.id = 'bili-batch-block-panel';
    panel.innerHTML = `
        <div class="panel-header">
            <h3> 拉黑 </h3>
            <span id="close-panel" style="cursor:pointer;font-size:18px;">&times;</span>
        </div>
        <div class="panel-stats">
            已选: <span id="block-count" style="color:#fb7299;font-weight:bold;">0</span> 人
        </div>
        <button id="do-block-btn" class="bili-block-btn">一键拉黑</button>
        <div id="block-status" class="status"></div>
    `;
    document.body.appendChild(panel);
    
    // 绑定事件
    document.getElementById('do-block-btn').addEventListener('click', startBatchBlock);
    document.getElementById('close-panel').addEventListener('click', togglePanel);
    trigger.addEventListener('click', togglePanel);
    
    return panel;
}

// 添加面板切换函数
function togglePanel() {
    const panel = document.getElementById('bili-batch-block-panel');
    const trigger = document.getElementById('bili-block-trigger');
    
    if (panel.classList.contains('expanded')) {
        panel.classList.remove('expanded');
        trigger.style.display = 'flex';
    } else {
        panel.classList.add('expanded');
        trigger.style.display = 'none';
    }
}

    function updatePanelUI() {
        const span = document.getElementById('block-count');
        if (span) span.innerText = selectedUsers.size;
    }

    function logStatus(msg, type) {
        const div = document.getElementById('block-status');
        if (!div) return;
        const p = document.createElement('div');
        p.innerText = msg;
        p.style.marginBottom = '3px';
        p.style.color = type === 'success' ? '#18a058' : (type === 'error' ? '#d03050' : '#333');
        div.prepend(p);
    }

    // 查找元素
    function getAllElements(root = document.body) {
        let elements = [];
        const nodes = root.querySelectorAll('*');
        nodes.forEach(node => {
            elements.push(node);
            if (node.shadowRoot) {
                elements = elements.concat(getAllElements(node.shadowRoot));
            }
        });
        return elements;
    }

    // 注入复选框
    function scanAndInject() {
        if (isProcessing) return; // 执行任务时暂停扫描，防止闪烁

        const allElements = getAllElements();
        const links = allElements.filter(el => el.tagName === 'A' && el.href && el.href.includes('//space.bilibili.com/'));

        links.forEach(link => {
            if (link.getAttribute('data-bili-block-processed')) return;
            if (link.querySelector('img')) return; 
            const name = link.innerText.trim();
            if (!name) return;

            // 简单判断是否在评论/动态区域
            let isTarget = false;
            let curr = link;
            for(let i=0; i<8; i++) {
                if(!curr) break;
                const tag = curr.tagName ? curr.tagName.toLowerCase() : '';
                const cls = curr.classList ? Array.from(curr.classList).join(' ') : '';
                // 增加 'opus' 适配 B站动态页
                if (tag.includes('comment') || tag.includes('reply') || tag.includes('opus') ||
                    cls.includes('reply') || cls.includes('comment')) {
                    isTarget = true;
                    break;
                }
                if (curr instanceof ShadowRoot) curr = curr.host;
                else curr = curr.parentNode;
            }
            if (!isTarget) return;

            const uidMatch = link.href.match(/space\.bilibili\.com\/(\d+)/);
            if (!uidMatch) return;
            const uid = uidMatch[1];

            link.setAttribute('data-bili-block-processed', 'true');

            // 注入复选框
            const wrapper = document.createElement('span');
            wrapper.style.cssText = 'display:inline-flex;align-items:center;margin-right:5px;vertical-align:middle;';
            wrapper.onclick = (e) => e.stopPropagation();

            const checkbox = document.createElement('input');
            checkbox.type = 'checkbox';
            checkbox.className = 'bili-block-checkbox';
            checkbox.style.cssText = 'width:14px;height:14px;cursor:pointer;accent-color:#fb7299;display:block;margin:0;';
            checkbox.dataset.uid = uid;
            checkbox.dataset.name = name;

            if (selectedUsers.has(uid)) checkbox.checked = true;

            checkbox.addEventListener('change', (e) => {
                const t = e.target;
                if (t.checked) selectedUsers.set(t.dataset.uid, t.dataset.name);
                else selectedUsers.delete(t.dataset.uid);
                updatePanelUI();
            });

            wrapper.appendChild(checkbox);
            link.parentNode.insertBefore(wrapper, link);
        });
    }

    // 执行拉黑
    async function startBatchBlock() {
        if (selectedUsers.size === 0) return alert("未勾选任何用户");
        
        // 1. 获取 Token
        const csrf = await getCsrfTokenFromBackground();
        if (!csrf) {
            logStatus("❌ 错误: 无法获取登录Token，请刷新页面", 'error');
            return;
        }

        if (!confirm(`确认拉黑 ${selectedUsers.size} 人?`)) return;
        
        const btn = document.getElementById('do-block-btn');
        btn.disabled = true; 
        btn.innerText = "处理中...";
        isProcessing = true;
        
        const users = Array.from(selectedUsers.entries());
        
        // 循环
        for (let i = 0; i < users.length; i++) {
            const [uid, name] = users[i];
            logStatus(`[${i+1}/${users.length}] 正在处理: ${name}...`);
            
            try {
                const fd = new URLSearchParams();
                fd.append('fid', uid); 
                fd.append('act', '5');      // 5=拉黑
                fd.append('re_src', '11'); 
                fd.append('csrf', csrf); 
                
                // 添加 credentials: 'include' ===
                const res = await fetch('https://api.bilibili.com/x/relation/modify', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/x-www-form-urlencoded'
                    },
                    body: fd,
                    credentials: 'include' // Cookie
                });

                const j = await res.json();
                
                if(j.code === 0) {
                    logStatus(`✅ 成功: ${name}`, 'success');
                    selectedUsers.delete(uid); // 只有成功才从列表中移除
                    
                    // 删除线
                    const checkboxes = document.querySelectorAll(`input.bili-block-checkbox[data-uid="${uid}"]`);
                    checkboxes.forEach(cb => {
                        cb.checked = false; 
                        cb.disabled = true;
                        if(cb.parentNode.nextSibling) {
                            cb.parentNode.nextSibling.style.textDecoration = 'line-through';
                            cb.parentNode.nextSibling.style.opacity = '0.5';
                        }
                    });
                } else if (j.code === -101) {
                    logStatus(`❌ 失败: 账号未登录 (请在B站登录)`, 'error');
                    // 未登录直接跳出循环
                    isProcessing = false;
                    btn.disabled = false; 
                    btn.innerText = "一键拉黑";
                    return; 
                } else {
                    logStatus(`❌ 失败: ${j.message}`, 'error');
                }

            } catch(e) { 
                console.error(e);
                logStatus(`❌ 网络/脚本错误: ${name}`, 'error');
                // 不return，继续处理下一个
            }
            
            updatePanelUI();
            
            // 延时，防止卡死
            await new Promise(r => setTimeout(r, REQUEST_DELAY));
        }

        isProcessing = false;
        btn.disabled = false; 
        btn.innerText = "一键拉黑";
        if (selectedUsers.size === 0) {
            logStatus("全部完成", 'success');
        } else {
            logStatus("部分失败，请检查", 'error');
        }
    }

    function init() {
        ensurePanel();
        setInterval(scanAndInject, POLL_INTERVAL);
        setTimeout(scanAndInject, 1500);
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();

})();
