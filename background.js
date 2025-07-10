// background.js - 后台脚本
chrome.runtime.onMessage.addListener(function(message, sender, sendResponse) {
  if (message.type === 'noteAdded') {
    // 更新今日备注统计
    const today = new Date().toISOString().split('T')[0];
    
    chrome.storage.local.get('notesStats', function(data) {
      const stats = data.notesStats || {};
      stats[today] = (stats[today] || 0) + 1;
      
      chrome.storage.local.set({ notesStats: stats });
    });
  }
});

