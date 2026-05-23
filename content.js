async function scrollAndLoadMore(pages, timeout = 180000) {
  console.log(`Bắt đầu crawl ${pages} trang...`);
  const start = Date.now();
  let currentPage = 0;
  let remainingPages = pages;

  const pageLabel = document.getElementById('pageLabel');
  if (pageLabel) pageLabel.textContent = `Còn: ${remainingPages} trang`;

  while (currentPage < pages && Date.now() - start < timeout) {
    window.scrollTo(0, document.body.scrollHeight);
    console.log(`Đã cuộn xuống cuối trang ${currentPage + 1}`);
    await new Promise(resolve => setTimeout(resolve, 2000));

    const loadMoreButton = document.querySelector('button[data-test="load-more"][data-loading="false"]');
    if (loadMoreButton) {
      console.log(`Tìm thấy nút "Show more jobs" cho trang ${currentPage + 1}, đang nhấn...`);
      loadMoreButton.click();
      await new Promise(resolve => setTimeout(resolve, 1000));

      const closePopupButton = document.querySelector('button.icon-button_IconButton__nMTOc[aria-label="Cancel"]');
      if (closePopupButton) {
        console.log('Tìm thấy popup, nhấn nút hủy...');
        closePopupButton.click();
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
    } else {
      console.log(`Không tìm thấy nút "Show more jobs" ở trang ${currentPage + 1}, có thể đã tải hết hoặc lỗi selector`);
      break;
    }
    currentPage++;
    remainingPages--;
    if (pageLabel) pageLabel.textContent = `Còn: ${remainingPages} trang`;
    if (currentPage === pages - 1) console.log('Đã crawl đủ số trang yêu cầu');
  }

  const jobCards = document.querySelectorAll('div[class="JobCard_jobCardContainer__arQlW"]');
  if (jobCards.length === 0) {
    throw new Error('Không tìm thấy job card nào sau khi tải. Hãy đảm bảo bạn đang ở trang danh sách việc làm (https://www.glassdoor.com/Job/*) và đã đăng nhập nếu cần.');
  }
  console.log(`Tìm thấy ${jobCards.length} job card sau ${Date.now() - start}ms`);
  return jobCards;
}

function updatePageCountDisplay() {
  console.log('Cập nhật hiển thị số trang...');
  chrome.storage.local.get(['pageCount'], (result) => {
    const pageCount = parseInt(result.pageCount, 10) || 1;
    console.log(`Số trang lấy được từ storage: ${pageCount}`);
    const pageLabel = document.getElementById('pageLabel');
    if (pageLabel) pageLabel.textContent = `Còn: ${pageCount} trang`;
  });
}

function savePageCount() {
  const pageInput = document.getElementById('pageInput');
  const pageCount = parseInt(pageInput.value, 10) || 1;
  console.log(`Đã nhập số trang: ${pageCount}`);
  chrome.storage.local.set({ pageCount: pageCount }, () => {
    console.log(`Đã lưu số trang ${pageCount} vào storage`);
    updatePageCountDisplay();
  });
}

function initializeCrawler() {
  console.log('Khởi tạo crawler...');
  const crawlContainer = document.createElement('div');
  crawlContainer.className = 'crawl-container';

  const crawlButton = document.createElement('button');
  crawlButton.textContent = 'Crawl Jobs to CSV';
  crawlButton.id = 'crawlButton';
  crawlButton.setAttribute('aria-label', 'Crawl danh sách việc làm');

  const pageInput = document.createElement('input');
  pageInput.id = 'pageInput';
  pageInput.type = 'number';
  pageInput.min = '1';
  pageInput.value = '1';
  pageInput.style.width = '60px';
  pageInput.style.margin = '0 10px';
  pageInput.style.padding = '5px';
  pageInput.style.fontSize = '16px';

  const saveButton = document.createElement('button');
  saveButton.textContent = 'Lưu';
  saveButton.setAttribute('aria-label', 'Lưu số trang');
  saveButton.style.padding = '5px 10px';
  saveButton.style.backgroundColor = '#4CAF50';
  saveButton.style.color = 'white';
  saveButton.style.border = 'none';
  saveButton.style.borderRadius = '4px';
  saveButton.style.cursor = 'pointer';
  saveButton.style.fontSize = '16px';
  saveButton.addEventListener('click', savePageCount);

  const pageLabel = document.createElement('span');
  pageLabel.id = 'pageLabel';
  pageLabel.style.marginLeft = '10px';
  pageLabel.style.color = 'white';
  pageLabel.style.fontSize = '16px';

  crawlContainer.appendChild(crawlButton);
  crawlContainer.appendChild(pageInput);
  crawlContainer.appendChild(saveButton);
  crawlContainer.appendChild(pageLabel);
  document.body.appendChild(crawlContainer);

  updatePageCountDisplay();

  crawlButton.addEventListener('click', async () => {
    console.log('Nút crawl được nhấn, đang lấy số trang...');
    chrome.storage.local.get(['pageCount'], async (result) => {
      const pageCount = parseInt(result.pageCount, 10) || 1;
      console.log(`Đang crawl ${pageCount} trang...`);

      try {
        const jobElements = await scrollAndLoadMore(pageCount);
        console.log('Bắt đầu crawl...');
        const jobs = [['Company Name', 'Job Title', 'Link', 'Salary', 'Location', 'Date Posted', 'Easy Apply']]; // Thêm header cho CSV
        const seenJobIds = new Set();

        if (!jobElements.length) {
          console.error('Không tìm thấy job card nào trên trang');
          alert('Không tìm thấy việc làm! Hãy đảm bảo bạn đang ở trang danh sách việc làm.');
          return;
        }

        jobElements.forEach((job, index) => {
          let date_post = 'N/A';
          let company_name = 'N/A';
          let location = 'N/A';
          let job_title = 'N/A';
          let salary = 'N/A';
          let link_job = 'N/A';
          let easy_apply = 'N/A';

          try {
            const linkElement = job.querySelector('a[data-test="job-link"]');
            link_job = linkElement ? linkElement.getAttribute('href') || 'N/A' : 'N/A';
            if (link_job !== 'N/A' && !link_job.startsWith('http')) {
              link_job = `https://www.glassdoor.com${link_job}`;
              console.log(`Đã thêm tiền tố cho link: ${link_job}`);
            } else if (link_job === 'N/A') {
              console.warn(`Link không tìm thấy cho job ${index + 1}`);
            }

            const jobIdMatch = link_job.match(/jobListingId=(\d+)/);
            const jobId = jobIdMatch ? jobIdMatch[1] : null;
            if (jobId && seenJobIds.has(jobId)) {
              console.log(`Bỏ qua việc làm trùng lặp ID: ${jobId}`);
              return;
            }
            if (jobId) seenJobIds.add(jobId);

            date_post = job.querySelector('div[class*="JobCard_listingAge__jJsuc"]')?.textContent.trim() || 'N/A';
            company_name = job.querySelector('span[class*="EmployerProfile_compactEmployerName__9MGcV"]')?.textContent.trim() || 'N/A';
            location = job.querySelector('div[class*="JobCard_location__Ds1fM"]')?.textContent.trim() || 'N/A';
            job_title = job.querySelector('a[class*="JobCard_jobTitle__GLyJ1"]')?.textContent.trim() || 'N/A';
            salary = job.querySelector('div[class*="JobCard_salaryEstimate__QpbTW"]')?.textContent.trim() || 'N/A';
            easy_apply = job.querySelector('div[class*="JobCard_easyApplyTag__5vlo5"]') ? 'Yes' : 'No';

            if ([link_job, company_name, job_title, salary, location, date_post, easy_apply].every(val => val === 'N/A')) {
              console.log(`Việc làm ${index + 1}: Bỏ qua (tất cả trường N/A)`);
              return;
            }

            console.log(`Việc làm ${index + 1}:`);
            console.log(`  Tên công ty: ${company_name}`);
            console.log(`  Địa điểm: ${location}`);
            console.log(`  Tiêu đề: ${job_title}`);
            console.log(`  Lương: ${salary}`);
            console.log(`  Link: ${link_job}`);
            console.log(`  Ngày đăng: ${date_post}`);
            console.log(`  Easy Apply: ${easy_apply}`);
            console.log('-'.repeat(50));

            jobs.push([company_name, job_title, link_job, salary, location, date_post, easy_apply]);
          } catch (e) {
            console.error(`Lỗi xử lý việc làm ${index + 1}: ${e.message}`);
          }
        });

        try {
          if (jobs.length === 1) {
            console.error('Không tìm thấy việc làm hợp lệ để lưu vào CSV');
            alert('Không tìm thấy việc làm hợp lệ để lưu vào CSV.');
            return;
          }
          // Lấy số job hợp lệ (trừ header)
          const validJobCount = jobs.length - 1;
          // Lấy title của trang web, loại bỏ tất cả số và dấu gạch dưới ở đầu
          let fileTitle = document.title.replace(/^\d+(?:_\d+)*_/, ''); // Loại bỏ số và dấu gạch dưới ở đầu
          fileTitle = fileTitle.replace(/[\/\\:\*\?"<>\|]/g, '_'); // Loại bỏ ký tự không hợp lệ
          fileTitle = encodeURIComponent(fileTitle).replace(/%[0-9A-F]{2}/gi, '_'); // Mã hóa và thay ký tự đặc biệt
          const csvContent = jobs.map(row => row.map(cell => {
            if (typeof cell === 'string' && (cell.startsWith('https://') || cell.startsWith('http://'))) {
              return cell; // Định dạng hyperlink cho Excel
            }
            return `"${cell.replace(/"/g, '""')}"`;
          }).join(',')).join('\n');
          const dataStr = 'data:text/csv;charset=utf-8,' + encodeURIComponent(csvContent);
          const downloadAnchor = document.createElement('a');
          downloadAnchor.setAttribute('href', dataStr);
          downloadAnchor.setAttribute('download', `${validJobCount}_${fileTitle}.csv`);
          document.body.appendChild(downloadAnchor);
          downloadAnchor.click();
          downloadAnchor.remove();
          alert(`Đã crawl ${validJobCount} việc làm và lưu vào CSV!`);
        } catch (e) {
          console.error(`Lỗi tạo CSV: ${e.message}`);
          alert('Lỗi tạo CSV. Kiểm tra console để biết chi tiết.');
        }
      } catch (err) {
        console.error(`Crawl thất bại: ${err.message}`);
        alert(`Crawl thất bại: ${err.message}`);
      }
    });
  });
}

if (document.readyState === 'complete' || document.readyState === 'interactive') {
  initializeCrawler();
} else {
  document.addEventListener('DOMContentLoaded', initializeCrawler);
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'updatePageCount') {
    console.log('Nhận được thông điệp updatePageCount từ background');
    updatePageCountDisplay();
    sendResponse({ status: 'updated' });
  }
});