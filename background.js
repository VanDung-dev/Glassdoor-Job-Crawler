chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'updatePageCount') {
    console.log('Background nhận được thông điệp updatePageCount, chuyển tiếp đến content script');
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]) {
        chrome.tabs.sendMessage(tabs[0].id, message, (response) => {
          if (chrome.runtime.lastError) {
            console.error('Chuyển tiếp thông điệp thất bại:', chrome.runtime.lastError);
          } else {
            sendResponse({ status: 'updated' });
          }
        });
      }
    });
    return true; // Bắt buộc để giữ kết nối bất đồng bộ
  }
});