(function () {
    'use strict';

    const userNotesDB = {};
    let currentUserId = null;
    // 用于跟踪已处理的元素，避免重复处理
    let processedElements = new WeakSet();
    // 用于缓存用户ID，提高性能
    const userIdCache = new Map();
    // 用于调试
    const debug = false;

    function log(...args) {
        if (debug) {
            console.log('[Twitter Notes]', ...args);
        }
    }

    function isValidUserId(userId) {
        return typeof userId === 'string' && /^[A-Za-z0-9_]+$/.test(userId);
    }

    function initNotesDB() {
        if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.local) {
            chrome.storage.local.get('twitterNotes', data => {
                if (chrome.runtime.lastError) return;
                if (data.twitterNotes) {
                    Object.assign(userNotesDB, data.twitterNotes);
                    // 初始化完成后立即处理页面元素
                    processUserElements();
                    // 添加额外的处理，确保所有元素都被处理
                    setTimeout(processAllElements, 500);
                }
            });
        }
    }

    function saveNoteToStorage(userId, note) {
        const previousNote = userNotesDB[userId];

        if (note) {
            userNotesDB[userId] = note;
        } else {
            delete userNotesDB[userId];
        }

        if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.local) {
            chrome.storage.local.set({ twitterNotes: userNotesDB }, () => {
                if (!chrome.runtime.lastError) {
                    // 更新所有相关用户的备注显示
                    updateAllNotesForUser(userId);

                    // 如果是新增备注或修改备注，发送消息到后台
                    if (note && (!previousNote || previousNote !== note)) {
                        chrome.runtime.sendMessage({ type: 'noteAdded' });
                    }
                }
            });
        }
    }

    // 判断是否为共同关注推荐区域或"推荐关注"栏
    function isSuggestSection(container) {
        if (!container) return false;

        if (
            container.closest('section[aria-labelledby]') &&
            (
                container.closest('section[aria-labelledby]').innerText.includes('推荐关注') ||
                container.closest('section[aria-labelledby]').innerText.includes('Who to follow')
            )
        ) return true;

        if (
            container.closest('div[aria-label*="认识的人"]') ||
            container.closest('div[aria-label*="People you"]')
        ) return true;

        if (
            container.innerText &&
            (container.innerText.trim() === '显示更多' || container.innerText.trim() === 'Show more')
        ) return true;

        return false;
    }

    // 判断是否为转发内容 - 改进版，更准确地识别各种转发内容
    function isRetweetContent(container) {
        if (!container) return false;

        // 检查是否有转发标识
        const hasRetweetIndicator = container.querySelector('span[data-testid="socialContext"]');
        if (hasRetweetIndicator) return true;

        // 检查是否在引用推文内部
        const isInQuotedTweet = container.closest('div[role="link"][data-testid="card.wrapper"]');
        if (isInQuotedTweet) return true;

        // 检查是否为回复中引用的推文
        const isReplyQuote = container.closest('div[data-testid="reply-to-conversation"]');
        if (isReplyQuote && container.querySelector('div[data-testid="User-Name"]')?.closest('a')?.getAttribute('href')?.includes('/status/')) {
            return true;
        }

        return false;
    }

    // 从用户单元格中提取用户ID - 增强版本，处理更多情况
    function getUserIdFromUserCell(container) {
        // 先检查缓存
        const cacheKey = container.dataset.twitterNoteId;
        if (cacheKey && userIdCache.has(cacheKey)) {
            return userIdCache.get(cacheKey);
        }

        // 查找带@的用户名
        const usernameElements = Array.from(container.querySelectorAll('span'));
        for (const span of usernameElements) {
            if (span.textContent && span.textContent.startsWith('@')) {
                const userId = span.textContent.slice(1);
                if (isValidUserId(userId)) {
                    // 存入缓存
                    if (cacheKey) userIdCache.set(cacheKey, userId);
                    return userId;
                }
            }
        }

        // 如果找不到带@的用户名，尝试查找链接中的用户名
        const userLinks = container.querySelectorAll('a[href^="/"]');
        for (const userLink of userLinks) {
            const href = userLink.getAttribute('href');
            // 确保链接不是通知、搜索等页面
            if (href && !href.match(/^\/(home|explore|notifications|messages|search|compose|i|settings)/)) {
                const pathParts = href.split('/').filter(Boolean);
                if (pathParts.length > 0 && isValidUserId(pathParts[0])) {
                    // 存入缓存
                    if (cacheKey) userIdCache.set(cacheKey, pathParts[0]);
                    return pathParts[0];
                }
            }
        }

        return null;
    }

    // 从推文中提取用户ID - 增强版，支持更多推文类型
    function getUserIdFromTweet(container) {
        // 先检查缓存
        const cacheKey = container.dataset.twitterNoteId;
        if (cacheKey && userIdCache.has(cacheKey)) {
            return userIdCache.get(cacheKey);
        }

        // 检查是否为转发内容，如果是则不处理
        if (isRetweetContent(container)) {
            return null;
        }

        // 查找推文作者区域
        const userNameContainer = container.querySelector('div[data-testid="User-Name"]');
        if (userNameContainer) {
            // 查找@用户名
            const usernameEl = Array.from(userNameContainer.querySelectorAll('span')).find(
                span => span.textContent && span.textContent.startsWith('@')
            );

            if (usernameEl && usernameEl.textContent) {
                const userId = usernameEl.textContent.slice(1);
                if (isValidUserId(userId)) {
                    // 存入缓存
                    if (cacheKey) userIdCache.set(cacheKey, userId);
                    return userId;
                }
            }

            // 备用：查找链接
            const userLink = userNameContainer.querySelector('a[href^="/"]');
            if (userLink) {
                const href = userLink.getAttribute('href');
                if (href && !href.match(/^\/(home|explore|notifications|messages|search|compose|i|settings)/)) {
                    const pathParts = href.split('/').filter(Boolean);
                    if (pathParts.length > 0 && isValidUserId(pathParts[0])) {
                        // 存入缓存
                        if (cacheKey) userIdCache.set(cacheKey, pathParts[0]);
                        return pathParts[0];
                    }
                }
            }
        }

        // 新增：处理被引用的推文
        const quotedTweet = container.querySelector('div[data-testid="tweet"] div[data-testid="User-Name"]');
        if (quotedTweet && !container.matches('div[data-testid="tweet"]')) {
            const usernameEl = Array.from(quotedTweet.querySelectorAll('span')).find(
                span => span.textContent && span.textContent.startsWith('@')
            );

            if (usernameEl && usernameEl.textContent) {
                const userId = usernameEl.textContent.slice(1);
                if (isValidUserId(userId)) {
                    // 存入缓存
                    if (cacheKey) userIdCache.set(cacheKey, userId);
                    return userId;
                }
            }
        }

        return null;
    }

    // 从用户名区域提取用户ID
    function getUserIdFromUserName(container) {
        // 先检查缓存
        const cacheKey = container.dataset.twitterNoteId;
        if (cacheKey && userIdCache.has(cacheKey)) {
            return userIdCache.get(cacheKey);
        }

        // 查找@用户名
        const usernameElements = Array.from(container.querySelectorAll('span'));
        for (const span of usernameElements) {
            if (span.textContent && span.textContent.startsWith('@')) {
                const userId = span.textContent.slice(1);
                if (isValidUserId(userId)) {
                    // 存入缓存
                    if (cacheKey) userIdCache.set(cacheKey, userId);
                    return userId;
                }
            }
        }

        // 备用：查找链接
        const userLinks = container.querySelectorAll('a[href^="/"]');
        for (const userLink of userLinks) {
            const href = userLink.getAttribute('href');
            if (href && !href.match(/^\/(home|explore|notifications|messages|search|compose|i|settings)/)) {
                const pathParts = href.split('/').filter(Boolean);
                if (pathParts.length > 0 && isValidUserId(pathParts[0])) {
                    // 存入缓存
                    if (cacheKey) userIdCache.set(cacheKey, pathParts[0]);
                    return pathParts[0];
                }
            }
        }

        // 备用：从URL获取（用于个人资料页）
        if (
            window.location.pathname.match(/^\/[^/]+\/?$/) &&
            !['/home', '/explore', '/notifications', '/messages', '/search', '/compose', '/i', '/settings'].includes(
                window.location.pathname
            )
        ) {
            const pathParts = window.location.pathname.split('/');
            if (pathParts.length > 1 && isValidUserId(pathParts[1])) {
                // 存入缓存
                if (cacheKey) userIdCache.set(cacheKey, pathParts[1]);
                return pathParts[1];
            }
        }

        return null;
    }

    // 获取用户ID - 根据不同容器类型使用不同的提取方法
    function getUserIdFromContainer(container) {
        if (!container || !container.isConnected) return null;

        // 为每个容器创建唯一标识，用于缓存
        if (!container.dataset.twitterNoteId) {
            container.dataset.twitterNoteId = Math.random().toString(36).substring(2, 10);
        }

        let userId = null;

        // 根据容器类型选择不同的提取方法
        if (container.matches('div[data-testid="UserCell"], div[role="link"][data-testid="UserCell"], div[data-testid="cellInnerDiv"]')) {
            userId = getUserIdFromUserCell(container);
        }
        else if (container.matches('article[data-testid="tweet"], div[data-testid="tweet"]')) {
            userId = getUserIdFromTweet(container);
        }
        else if (container.matches('div[data-testid="UserName"]')) {
            userId = getUserIdFromUserName(container);
        }
        // 处理引用推文
        else if (container.querySelector('div[data-testid="tweet"]')) {
            const tweetElement = container.querySelector('div[data-testid="tweet"]');
            userId = getUserIdFromTweet(tweetElement);
        }
        // 尝试从任何元素中提取用户ID（更宽松的匹配）
        else {
            // 查找@用户名
            const usernameElements = Array.from(container.querySelectorAll('span'));
            for (const span of usernameElements) {
                if (span.textContent && span.textContent.startsWith('@')) {
                    const userId = span.textContent.slice(1);
                    if (isValidUserId(userId)) {
                        return userId;
                    }
                }
            }

            // 查找用户链接
            const userLinks = container.querySelectorAll('a[href^="/"]');
            for (const userLink of userLinks) {
                const href = userLink.getAttribute('href');
                if (href && !href.match(/^\/(home|explore|notifications|messages|search|compose|i|settings)/)) {
                    const pathParts = href.split('/').filter(Boolean);
                    if (pathParts.length > 0 && isValidUserId(pathParts[0])) {
                        return pathParts[0];
                    }
                }
            }
        }

        // 存储用户ID到容器的数据属性中，方便调试
        if (userId) {
            container.dataset.twitterNoteUserId = userId;
        }

        return userId;
    }

    // 获取主用户ID - 用于个人资料页面
    function getMainTwitterUserId() {
        if (
            window.location.pathname.match(/^\/[^/]+\/?$/) &&
            !['/home', '/explore', '/notifications', '/messages', '/search', '/compose', '/i', '/settings'].includes(
                window.location.pathname
            )
        ) {
            const pathParts = window.location.pathname.split('/');
            if (pathParts.length > 1 && isValidUserId(pathParts[1])) {
                return pathParts[1];
            }
        }
        return null;
    }

    // 查找用户名元素（非@用户名）- 增强版，处理更多情况
    function findDisplayNameElement(container) {
        if (!container || !container.isConnected) return null;

        // 在推文中查找用户名
        if (container.matches('article[data-testid="tweet"], div[data-testid="tweet"]')) {
            // 直接查找第一个用户名元素
            const nameElement = container.querySelector('div[data-testid="User-Name"] a > div > span');
            if (nameElement) return nameElement;

            // 备用：查找用户名区域中的第一个span
            const userNameDiv = container.querySelector('div[data-testid="User-Name"]');
            if (userNameDiv) {
                const spans = Array.from(userNameDiv.querySelectorAll('span'));
                // 找到第一个不是@开头的span
                const nameSpan = spans.find(span => span.textContent && !span.textContent.startsWith('@'));
                if (nameSpan) return nameSpan;
            }

            // 处理媒体推文中的用户名
            const mediaUserName = container.querySelector('div[data-testid="tweetPhoto"] + div div[data-testid="User-Name"] span');
            if (mediaUserName) return mediaUserName;
        }

        // 在用户单元格中查找用户名
        if (container.matches('div[data-testid="UserCell"], div[role="link"][data-testid="UserCell"], div[data-testid="cellInnerDiv"]')) {
            // 查找所有span元素
            const spans = Array.from(container.querySelectorAll('span'));
            // 找到@用户名元素
            const usernameSpan = spans.find(span => span.textContent && span.textContent.startsWith('@'));
            if (usernameSpan) {
                // 用户名通常是@用户名之前的元素
                const index = spans.indexOf(usernameSpan);
                if (index > 0) return spans[index - 1];
            }

            // 备用方案：查找第一个span元素
            if (spans.length > 0) return spans[0];
        }

        // 在用户名区域查找用户名
        if (container.matches('div[data-testid="UserName"]')) {
            const nameElement = container.querySelector('div[data-testid="UserName"] a > div > span');
            if (nameElement) return nameElement;

            // 备用方案：查找第一个span元素
            const spans = Array.from(container.querySelectorAll('span'));
            if (spans.length > 0) {
                // 找到第一个不是@开头的span
                const nameSpan = spans.find(span => span.textContent && !span.textContent.startsWith('@'));
                if (nameSpan) return nameSpan;
            }
        }

        // 处理引用推文中的用户名
        const quotedTweet = container.querySelector('div[data-testid="tweet"]');
        if (quotedTweet) {
            return findDisplayNameElement(quotedTweet);
        }

        // 通用查找方法 - 查找任何可能是用户名的元素
        const spans = Array.from(container.querySelectorAll('span'));
        const usernameSpan = spans.find(span => span.textContent && span.textContent.startsWith('@'));
        if (usernameSpan) {
            // 用户名通常是@用户名之前的元素
            const index = spans.indexOf(usernameSpan);
            if (index > 0) return spans[index - 1];
        }

        return null;
    }

    // 动态设置备注最大宽度 - 优化版，考虑更多场景
    function setNoteMaxWidth(noteSpan, container) {
        if (!noteSpan || !noteSpan.isConnected || !container || !container.isConnected) return;

        // 检查是否为引用推文或嵌套推文
        const isQuotedTweet = container.closest('div[role="link"][data-testid="card.wrapper"]') ||
            container.closest('div[data-testid="reply-to-conversation"]');

        // 检查是否为媒体推文
        const isMediaTweet = container.querySelector('div[data-testid="tweetPhoto"]') ||
            container.querySelector('div[data-testid="videoPlayer"]');

        if (isQuotedTweet) {
            // 引用推文使用较小的宽度
            noteSpan.style.maxWidth = "120px";
            return;
        }

        if (isMediaTweet) {
            // 媒体推文使用较大的宽度
            noteSpan.style.maxWidth = "200px";
            return;
        }

        const followBtn = container.querySelector(
            'div[role="button"][data-testid$="follow"], div[role="button"][data-testid$="unfollow"], div[aria-label*="关注"], div[aria-label*="通知"]'
        );

        if (!followBtn) {
            // 如果没有关注按钮，使用容器宽度的40%
            const containerRect = container.getBoundingClientRect();
            noteSpan.style.maxWidth = Math.max(Math.min(containerRect.width * 0.4, 200), 60) + "px";
            return;
        }

        try {
            // 获取视口中的位置
            const noteRect = noteSpan.getBoundingClientRect();
            const btnRect = followBtn.getBoundingClientRect();

            // 计算可用空间
            let maxWidth = btnRect.left - noteRect.left - 16;

            // 如果计算出的宽度不合理，使用固定值
            if (maxWidth < 60 || maxWidth > 1000) {
                maxWidth = 150;
            }

            noteSpan.style.maxWidth = maxWidth + "px";
        } catch (e) {
            // 如果出现错误，使用默认值
            noteSpan.style.maxWidth = "150px";
        }
    }

    // 添加备注到元素 - 增强版，支持更多推文类型和显示样式
    function addNoteToElement(container, isProfilePage) {
        if (!container || !container.isConnected) return;

        // 检查是否已处理过该元素
        if (processedElements.has(container)) return;

        if (isSuggestSection(container)) return;

        // 如果是转发内容，不添加备注
        if (isRetweetContent(container)) return;

        const userId = getUserIdFromContainer(container);
        if (!isValidUserId(userId)) return;

        // 移除现有备注元素
        container.querySelectorAll('.x-note-icon, .x-note-text').forEach((el) => el.remove());

        const note = userNotesDB[userId];
        if (note) {
            // 查找用户名元素（非@用户名）
            const displayNameElement = findDisplayNameElement(container);

            if (displayNameElement) {
                // 创建备注元素
                const noteSpan = document.createElement('span');
                noteSpan.className = 'x-note-text';
                noteSpan.textContent = note;
                noteSpan.dataset.username = userId;
                noteSpan.setAttribute('title', note); // 添加title属性，方便查看完整内容

                // 检查是否为引用推文
                const isQuotedTweet = container.closest('div[role="link"][data-testid="card.wrapper"]') ||
                    container.closest('div[data-testid="reply-to-conversation"]');

                // 检查是否为媒体推文
                const isMediaTweet = container.querySelector('div[data-testid="tweetPhoto"]') ||
                    container.querySelector('div[data-testid="videoPlayer"]');

                // 根据不同类型设置不同的样式
                if (isQuotedTweet) {
                    noteSpan.classList.add('x-note-quoted-tweet');
                } else if (isMediaTweet) {
                    noteSpan.classList.add('x-note-media-tweet');
                }

                // 将备注插入到用户名后面
                if (displayNameElement.nextSibling) {
                    displayNameElement.parentNode.insertBefore(noteSpan, displayNameElement.nextSibling);
                } else {
                    displayNameElement.parentNode.appendChild(noteSpan);
                }

                // 为推荐关注区域设置特殊样式
                if (
                    container.closest('div[aria-label*="认识的人"]') ||
                    container.closest('div[aria-label*="People you"]')
                ) {
                    noteSpan.style.display = "block";
                    noteSpan.style.margin = "4px 0 0 0";
                    noteSpan.style.maxWidth = "100%";
                    noteSpan.style.whiteSpace = "normal";
                    noteSpan.style.overflow = "visible";
                    noteSpan.style.textOverflow = "clip";
                } else {
                    // 普通区域的样式
                    noteSpan.style.whiteSpace = "nowrap";
                    noteSpan.style.overflow = "hidden";
                    noteSpan.style.textOverflow = "ellipsis";

                    // 立即调整宽度
                    setNoteMaxWidth(noteSpan, container);
                }

                // 为备注添加点击事件，点击后显示完整备注
                noteSpan.addEventListener('click', (e) => {
                    e.stopPropagation();
                    showNotePopup(userId, container);
                });
            }
        }

        // 标记为已处理
        processedElements.add(container);

        // 在个人资料页添加编辑图标
        if (isProfilePage && container.matches('div[data-testid="UserName"]')) {
            const icon = document.createElement('span');
            icon.className = 'x-note-icon';
            icon.textContent = '✎';
            icon.addEventListener('click', (e) => {
                e.stopPropagation();
                showNotePopup(userId, container);
            });

            const nameContainer = container.querySelector('div[data-testid="UserName"] div[dir]');
            if (nameContainer) {
                nameContainer.appendChild(icon);
            }
        }
    }

    // 显示备注弹窗 - 优化版，提供更好的用户体验
    function showNotePopup(userId, parentElement) {
        document.querySelectorAll('.x-note-popup').forEach((popup) => popup.remove());

        const popup = document.createElement('div');
        popup.className = 'x-note-popup';

        const usernameDisplay = document.createElement('div');
        usernameDisplay.className = 'x-note-username';
        usernameDisplay.textContent = `备注用户: @${userId}`;

        // 添加链接到用户资料
        const profileLink = document.createElement('a');
        profileLink.href = `https://twitter.com/${userId}`;
        profileLink.className = 'x-note-profile-link';
        profileLink.textContent = '查看资料';
        profileLink.target = '_blank';
        usernameDisplay.appendChild(profileLink);

        const input = document.createElement('textarea'); // 使用textarea代替input，支持多行备注
        input.className = 'x-note-input';
        input.placeholder = '输入备注...';
        input.value = userNotesDB[userId] || '';

        // 自动调整高度
        input.style.height = 'auto';
        input.style.height = (input.scrollHeight) + 'px';
        input.addEventListener('input', function () {
            this.style.height = 'auto';
            this.style.height = (this.scrollHeight) + 'px';
        });

        const buttonContainer = document.createElement('div');
        buttonContainer.className = 'x-note-button-container';

        const saveButton = document.createElement('button');
        saveButton.className = 'x-note-save-button';
        saveButton.textContent = '保存';
        saveButton.addEventListener('click', () => {
            const noteValue = input.value.trim();
            saveNoteToStorage(userId, noteValue);
            popup.remove();
        });

        const cancelButton = document.createElement('button');
        cancelButton.className = 'x-note-cancel-button';
        cancelButton.textContent = '取消';
        cancelButton.addEventListener('click', () => popup.remove());

        const deleteButton = document.createElement('button');
        deleteButton.className = 'x-note-delete-button';
        deleteButton.textContent = '删除';
        deleteButton.addEventListener('click', () => {
            if (confirm(`确定要删除对 @${userId} 的备注吗？`)) {
                saveNoteToStorage(userId, '');
                popup.remove();
            }
        });

        buttonContainer.appendChild(saveButton);
        buttonContainer.appendChild(cancelButton);
        buttonContainer.appendChild(deleteButton);
        popup.appendChild(usernameDisplay);
        popup.appendChild(input);
        popup.appendChild(buttonContainer);

        // 改进弹窗位置计算
        const rect = parentElement.getBoundingClientRect();
        popup.style.position = 'fixed';
        popup.style.zIndex = '10000';

        // 先添加到DOM，这样可以获取实际尺寸
        document.body.appendChild(popup);

        // 计算最佳位置
        const popupRect = popup.getBoundingClientRect();
        let top = rect.bottom + 5;
        let left = rect.left;

        // 确保弹窗不会超出视口
        if (top + popupRect.height > window.innerHeight) {
            top = rect.top - popupRect.height - 5;
        }

        if (left + popupRect.width > window.innerWidth) {
            left = window.innerWidth - popupRect.width - 10;
        }

        popup.style.top = `${top}px`;
        popup.style.left = `${left}px`;

        setTimeout(() => {
            document.addEventListener(
                'click',
                (e) => {
                    if (!popup.contains(e.target)) {
                        popup.remove();
                    }
                },
                { once: true }
            );
        }, 100);

        input.focus();
    }

    // 更新特定用户的所有备注 - 增强版，确保所有元素都被更新
    function updateAllNotesForUser(userId) {
        const isProfilePage = /^\/[^/]+$/.test(window.location.pathname);

        // 重置处理标记，允许重新处理
        processedElements = new WeakSet();

        // 清除该用户的所有现有备注
        document.querySelectorAll('.x-note-text').forEach((el) => {
            if (el.dataset.username === userId) {
                el.remove();
            }
        });

        // 使用更全面的选择器查找所有可能的用户元素
        const allPossibleElements = document.querySelectorAll(selectors.join(','));

        // 立即处理找到的元素
        allPossibleElements.forEach((container) => {
            try {
                const containerId = getUserIdFromContainer(container);
                if (containerId === userId) {
                    addNoteToElement(container, isProfilePage);
                }
            } catch (e) {
                console.error('Error updating note for user:', e);
            }
        });

        // 额外处理：查找所有span元素，检查是否有@用户名
        document.querySelectorAll('span').forEach(span => {
            if (span.textContent && span.textContent === `@${userId}`) {
                // 找到包含该用户名的容器
                let container = span.closest('article[data-testid="tweet"]') ||
                    span.closest('div[data-testid="tweet"]') ||
                    span.closest('div[data-testid="UserCell"]') ||
                    span.closest('div[data-testid="UserName"]');

                if (container && !processedElements.has(container)) {
                    addNoteToElement(container, isProfilePage);
                }
            }
        });
    }

    // 批量处理所有用户元素 - 确保不遗漏任何元素
    function processAllElements() {
        const isProfilePage = /^\/[^/]+$/.test(window.location.pathname);

        // 使用更全面的选择器
        const allSelectors = [
            'div[data-testid="UserName"]',
            'div[role="link"][data-testid="UserCell"]',
            'div[data-testid="UserCell"]',
            'div[data-testid="cellInnerDiv"]',
            'article[data-testid="tweet"]',
            'div[data-testid="tweet"]',
            'div[data-testid="card.wrapper"]',
            'div[data-testid="reply-to-conversation"]'
        ];

        const containers = document.querySelectorAll(allSelectors.join(','));

        // 使用更高效的处理方式
        for (const container of containers) {
            try {
                if (container.isConnected && !processedElements.has(container)) {
                    addNoteToElement(container, isProfilePage);
                }
            } catch (e) {
                console.error('Error processing element:', e);
            }
        }

        // 额外处理：查找所有可能的推文容器
        document.querySelectorAll('div[role="article"]').forEach(article => {
            if (!processedElements.has(article)) {
                try {
                    const userId = getUserIdFromContainer(article);
                    if (userId && userNotesDB[userId]) {
                        addNoteToElement(article, isProfilePage);
                    }
                } catch (e) {
                    // 忽略错误
                }
            }
        });
    }

    // 批量处理用户元素 - 优化版本
    function processUserElements() {
        const isProfilePage = /^\/[^/]+$/.test(window.location.pathname);
        const newUserId = getMainTwitterUserId();

        if (currentUserId !== newUserId) {
            currentUserId = newUserId;
            document.querySelectorAll('.x-note-icon, .x-note-text').forEach((el) => el.remove());
            // 重置处理标记
            processedElements = new WeakSet();
            // 清除缓存
            userIdCache.clear();
        }

        // 使用更高效的选择器
        const selectors = [
            'div[data-testid="UserName"]',
            'div[role="link"][data-testid="UserCell"]',
            'div[data-testid="UserCell"]',
            'div[data-testid="cellInnerDiv"]',
            'article[data-testid="tweet"]',
            'div[data-testid="tweet"]'
        ];

        const containers = document.querySelectorAll(selectors.join(','));

        // 立即处理前20个元素，提高响应速度
        const immediateProcess = Math.min(20, containers.length);
        for (let i = 0; i < immediateProcess; i++) {
            try {
                addNoteToElement(containers[i], isProfilePage);
            } catch (e) {
                console.error('Error processing element:', e);
            }
        }

        // 如果元素较多，使用requestAnimationFrame处理剩余元素
        if (containers.length > immediateProcess) {
            requestAnimationFrame(() => {
                const batchSize = 15;
                let index = immediateProcess;

                function processBatch() {
                    const end = Math.min(index + batchSize, containers.length);
                    for (let i = index; i < end; i++) {
                        try {
                            if (containers[i].isConnected) {
                                addNoteToElement(containers[i], isProfilePage);
                            }
                        } catch (e) {
                            console.error('Error processing element in batch:', e);
                        }
                    }

                    index = end;
                    if (index < containers.length) {
                        requestAnimationFrame(processBatch);
                    }
                }

                processBatch();
            });
        }

        // 延迟处理更复杂的容器
        setTimeout(() => {
            const complexContainers = document.querySelectorAll('div[data-testid="card.wrapper"], div[data-testid="reply-to-conversation"]');
            for (const container of complexContainers) {
                try {
                    if (container.isConnected && !processedElements.has(container)) {
                        addNoteToElement(container, isProfilePage);
                    }
                } catch (e) {
                    console.error('Error processing complex container:', e);
                }
            }
        }, 100);
    }

    function setupUrlChangeListener() {
        let lastUrl = location.href;
        const checkInterval = setInterval(() => {
            if (lastUrl !== location.href) {
                lastUrl = location.href;
                // 重置处理标记
                processedElements = new WeakSet();
                // 清除缓存
                userIdCache.clear();
                // 移除所有现有备注
                document.querySelectorAll('.x-note-icon, .x-note-text').forEach((el) => el.remove());

                // 立即处理一次
                processUserElements();

                // 然后在短暂延迟后再处理一次，确保动态加载的内容也被处理
                setTimeout(processUserElements, 300);

                // 最后在页面完全加载后再处理一次
                setTimeout(processAllElements, 1000);
            }
        }, 300); // 减少检查间隔，提高响应速度

        return checkInterval;
    }

    function setupMutationObserver() {
        let debounceTimer = null;
        const observer = new MutationObserver((mutations) => {
            let shouldProcess = false;
            let hasNewTweets = false;

            for (const mutation of mutations) {
                // 检查是否有新的推文或用户元素被添加
                for (const node of mutation.addedNodes) {
                    if (node.nodeType === 1) {
                        if (
                            (node.matches && (
                                node.matches('article[data-testid="tweet"]') ||
                                node.matches('div[data-testid="tweet"]') ||
                                node.matches('div[data-testid="UserCell"]')
                            )) ||
                            (node.querySelector && (
                                node.querySelector('article[data-testid="tweet"]') ||
                                node.querySelector('div[data-testid="tweet"]') ||
                                node.querySelector('div[data-testid="UserCell"]')
                            ))
                        ) {
                            hasNewTweets = true;
                            shouldProcess = true;
                            break;
                        }

                        // 检查其他可能包含用户信息的元素
                        if (
                            (node.matches && node.matches(
                                'div[data-testid="UserName"], div[role="link"][data-testid="UserCell"], div[data-testid="cellInnerDiv"]'
                            )) ||
                            (node.querySelector && node.querySelector(
                                'div[data-testid="UserName"], div[role="link"][data-testid="UserCell"], div[data-testid="cellInnerDiv"]'
                            ))
                        ) {
                            shouldProcess = true;
                            break;
                        }
                    }
                }

                // 如果发现了新推文，立即跳出循环
                if (hasNewTweets) break;
            }

            if (shouldProcess) {
                clearTimeout(debounceTimer);

                // 如果有新推文，立即处理
                if (hasNewTweets) {
                    processUserElements();
                }

                // 无论如何，都设置一个延迟处理，确保所有元素都被处理
                debounceTimer = setTimeout(() => {
                    processUserElements();
                }, hasNewTweets ? 200 : 100);
            }
        });

        observer.observe(document.body, {
            childList: true,
            subtree: true,
        });

        return observer;
    }

    function init() {
        initNotesDB();

        const style = document.createElement('style');
        style.textContent = `
      .x-note-icon {
        cursor: pointer;
        margin-left: 8px;
        background-color: #1DA1F2;
        color: white;
        font-size: 14px;
        padding: 2px 6px;
        border-radius: 4px;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        height: 20px;
        line-height: 1;
        position: relative;
        z-index: 1;
      }

      .x-note-text {
        margin-left: 8px;
        background-color: #1DA1F2;
        color: white;
        font-size: 14px;
        padding: 2px 8px;
        border-radius: 12px;
        display: inline-block;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        vertical-align: middle;
        position: relative;
        cursor: pointer;
        transition: none !important;
        z-index: 1;
      }
      
      /* 引用推文中的备注样式 */
      .x-note-quoted-tweet {
        font-size: 12px !important;
        padding: 1px 6px !important;
        margin-left: 4px !important;
      }
      
      /* 媒体推文中的备注样式 */
      .x-note-media-tweet {
        position: relative;
        z-index: 2;
        background-color: rgba(29, 161, 242, 0.9) !important;
      }

      .x-note-popup {
        position: fixed;
        background: white;
        border: 1px solid #e1e8ed;
        border-radius: 12px;
        padding: 12px;
        box-shadow: 0 4px 12px rgba(0,0,0,0.15);
        z-index: 10000;
        width: 300px;
      }

      .x-note-username {
        font-weight: bold;
        margin-bottom: 8px;
        color: #14171a;
        font-size: 14px;
        display: flex;
        justify-content: space-between;
        align-items: center;
      }
      
      .x-note-profile-link {
        color: #1DA1F2;
        font-size: 12px;
        text-decoration: none;
        font-weight: normal;
      }
      
      .x-note-profile-link:hover {
        text-decoration: underline;
      }

      .x-note-input {
        width: 100%;
        padding: 8px;
        border: 1px solid #e1e8ed;
        border-radius: 4px;
        margin-bottom: 12px;
        font-size: 14px;
        box-sizing: border-box;
        min-height: 80px;
        max-height: 200px;
        resize: vertical;
      }

      .x-note-button-container {
        display: flex;
        gap: 8px;
      }

      .x-note-save-button, .x-note-cancel-button, .x-note-delete-button {
        flex: 1;
        padding: 8px;
        border: none;
        border-radius: 4px;
        font-weight: bold;
        cursor: pointer;
        transition: background 0.2s;
        font-size: 14px;
      }

      .x-note-save-button {
        background: #1da1f2;
        color: white;
      }

      .x-note-save-button:hover {
        background: #1a91da;
      }

      .x-note-cancel-button {
        background: #657786;
        color: white;
      }

      .x-note-cancel-button:hover {
        background: #556270;
      }
      
      .x-note-delete-button {
        background: #e0245e;
        color: white;
      }
      
      .x-note-delete-button:hover {
        background: #c0143e;
      }

      /* 共同关注区域样式 */
      div[aria-label*="认识的人"] .x-note-text,
      div[aria-label*="People you"] .x-note-text {
        display: block;
        margin-left: 0;
        margin-top: 4px;
        max-width: 100% !important;
        position: relative;
        white-space: normal;
        overflow: visible;
        text-overflow: clip;
      }
      
      /* 单条推文页面样式 */
      div[data-testid="primaryColumn"] > div > div > div > div:first-child .x-note-text {
        font-size: 16px;
        padding: 3px 10px;
      }
      
      /* 夜间模式支持 */
      @media (prefers-color-scheme: dark) {
        .x-note-popup {
          background: #15202b;
          border-color: #38444d;
        }
        
        .x-note-username {
          color: #fff;
        }
        
        .x-note-input {
          background: #192734;
          border-color: #38444d;
          color: #fff;
        }
      }
    `;
        document.head.appendChild(style);

        // 设置观察者
        const observer = setupMutationObserver();
        const urlChangeInterval = setupUrlChangeListener();

        // 初始清理
        document.querySelectorAll('.x-note-icon, .x-note-text').forEach((el) => el.remove());

        // 立即处理一次
        processUserElements();

        // 短暂延迟后再处理一次，确保动态加载的内容也被处理
        setTimeout(processUserElements, 300);

        // 页面完全加载后再处理一次
        setTimeout(processAllElements, 1000);

        // 定期检查更新 - 减少频率以提高性能，但保持足够频繁以捕获新内容
        const periodicCheck = setInterval(processAllElements, 3000);

        // 添加键盘快捷键支持
        document.addEventListener('keydown', (e) => {
            // Alt+N 快捷键：为当前页面的主用户添加备注
            if (e.altKey && e.key === 'n') {
                const userId = getMainTwitterUserId();
                if (userId) {
                    const userNameContainer = document.querySelector('div[data-testid="UserName"]');
                    if (userNameContainer) {
                        e.preventDefault();
                        showNotePopup(userId, userNameContainer);
                    }
                }
            }
        });

        // 添加右键菜单支持
        document.addEventListener('contextmenu', (e) => {
            const target = e.target.closest('article[data-testid="tweet"], div[data-testid="UserCell"]');
            if (target) {
                const userId = getUserIdFromContainer(target);
                if (userId) {
                    const menuItem = document.createElement('div');
                    menuItem.textContent = `添加备注 @${userId}`;
                    menuItem.className = 'x-note-context-menu';
                    menuItem.style.position = 'fixed';
                    menuItem.style.top = `${e.clientY}px`;
                    menuItem.style.left = `${e.clientX}px`;
                    menuItem.style.background = '#fff';
                    menuItem.style.border = '1px solid #ccc';
                    menuItem.style.padding = '8px';
                    menuItem.style.borderRadius = '4px';
                    menuItem.style.cursor = 'pointer';
                    menuItem.style.zIndex = '10000';

                    menuItem.addEventListener('click', () => {
                        showNotePopup(userId, target);
                        document.body.removeChild(menuItem);
                    });

                    document.body.appendChild(menuItem);

                    document.addEventListener('click', () => {
                        if (document.body.contains(menuItem)) {
                            document.body.removeChild(menuItem);
                        }
                    }, { once: true });

                    e.preventDefault();
                }
            }
        });

        // 返回清理函数
        return function cleanup() {
            observer.disconnect();
            clearInterval(urlChangeInterval);
            clearInterval(periodicCheck);
            document.querySelectorAll('.x-note-icon, .x-note-text, .x-note-popup').forEach((el) => el.remove());
        };
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
