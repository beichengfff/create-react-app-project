// popup.js - 扩展弹出窗口的逻辑
document.addEventListener('DOMContentLoaded', function () {
    const searchInput = document.getElementById('searchInput');
    const searchResults = document.getElementById('searchResults');
    const totalNotesElement = document.getElementById('totalNotes');
    const todayNotesElement = document.getElementById('todayNotes');
    const exportBtn = document.getElementById('exportBtn');
    const importBtn = document.getElementById('importBtn');
    const importInput = document.getElementById('importInput');

    let twitterNotes = {};
    let todayCount = 0;

    // 加载备注数据
    function loadNotes() {
        chrome.storage.local.get('twitterNotes', function (data) {
            if (data.twitterNotes) {
                twitterNotes = data.twitterNotes;
                updateStats();

                // 初始不显示任何结果
                searchResults.innerHTML = '<div class="empty-state">请输入关键词搜索备注...</div>';
            }
        });

        // 加载今日备注统计
        const today = new Date().toISOString().split('T')[0];
        chrome.storage.local.get('notesStats', function (data) {
            if (data.notesStats && data.notesStats[today]) {
                todayCount = data.notesStats[today];
                todayNotesElement.textContent = todayCount;
            }
        });
    }

    // 更新统计信息
    function updateStats() {
        const totalCount = Object.keys(twitterNotes).length;
        totalNotesElement.textContent = totalCount;
    }

    // 渲染搜索结果
    function renderSearchResults(query = '') {
        searchResults.innerHTML = '';

        // 如果搜索框为空，显示提示信息而不是所有备注
        if (!query) {
            searchResults.innerHTML = '<div class="empty-state">请输入关键词搜索备注...</div>';
            return;
        }

        const results = Object.entries(twitterNotes).filter(([userId, note]) => {
            const lowerQuery = query.toLowerCase();
            return userId.toLowerCase().includes(lowerQuery) ||
                note.toLowerCase().includes(lowerQuery);
        });

        if (results.length === 0) {
            const noResults = document.createElement('div');
            noResults.className = 'result-item';
            noResults.textContent = '没有找到匹配的备注';
            searchResults.appendChild(noResults);
            return;
        }

        results.sort((a, b) => a[0].localeCompare(b[0]));

        results.forEach(([userId, note]) => {
            const resultItem = document.createElement('div');
            resultItem.className = 'result-item';

            const userDiv = document.createElement('div');
            userDiv.className = 'result-user';
            userDiv.textContent = `@${userId}`;

            const noteDiv = document.createElement('div');
            noteDiv.className = 'result-note';
            noteDiv.textContent = note;

            resultItem.appendChild(userDiv);
            resultItem.appendChild(noteDiv);

            // 点击跳转到用户页面
            resultItem.addEventListener('click', function () {
                chrome.tabs.create({ url: `https://twitter.com/${userId}` });
            });

            searchResults.appendChild(resultItem);
        });
    }

    // 搜索功能
    searchInput.addEventListener('input', function () {
        renderSearchResults(this.value);
    });

    // 导出备注
    exportBtn.addEventListener('click', function () {
        const notesData = JSON.stringify(twitterNotes, null, 2);
        const blob = new Blob([notesData], { type: 'text/plain' });
        const url = URL.createObjectURL(blob);
        const date = new Date().toISOString().split('T')[0];

        const a = document.createElement('a');
        a.href = url;
        a.download = `twitter_notes_${date}.txt`;
        a.click();

        setTimeout(() => {
            URL.revokeObjectURL(url);
        }, 100);
    });

    // 导入备注
    importBtn.addEventListener('click', function () {
        importInput.click();
    });

    importInput.addEventListener('change', function (event) {
        const file = event.target.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = function (e) {
            try {
                const importedNotes = JSON.parse(e.target.result);

                // 合并备注数据
                const mergedNotes = { ...twitterNotes, ...importedNotes };

                // 保存到存储
                chrome.storage.local.set({ twitterNotes: mergedNotes }, function () {
                    if (!chrome.runtime.lastError) {
                        twitterNotes = mergedNotes;
                        updateStats();

                        // 如果搜索框有内容，则更新搜索结果
                        if (searchInput.value) {
                            renderSearchResults(searchInput.value);
                        }

                        alert(`成功导入备注！共导入 ${Object.keys(importedNotes).length} 条备注。`);
                    } else {
                        alert('导入失败：' + chrome.runtime.lastError.message);
                    }
                });
            } catch (err) {
                alert('导入失败：文件格式不正确。请确保导入的是有效的JSON文件。');
            }
        };

        reader.readAsText(file);
        // 重置文件输入，允许重复选择同一文件
        this.value = '';
    });

    // 初始加载
    loadNotes();
});
