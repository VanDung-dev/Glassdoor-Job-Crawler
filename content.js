let isCrawling = false;
let authObserver = null;
let stopTimer = null;

function dismissAuthModals() {
  if (!isCrawling) return; // CHỈ can thiệp khi extension đang trong phiên crawl
  const dialogs = document.querySelectorAll('dialog, dialog[open], div[class*="Hardsell"], div[id*="Hardsell"], div[class*="backdrop"]');
  dialogs.forEach(d => {
    try {
      const closeBtn = d.querySelector('button[aria-label*="close" i], button[class*="Close"], svg')?.closest('button');
      if (closeBtn) closeBtn.click();
    } catch (e) {}
    try {
      if (typeof d.close === 'function') d.close();
    } catch (e) {}
    d.remove();
  });
  document.body.style.overflow = 'auto';
  document.documentElement.style.overflow = 'auto';
}

function startCrawlingSession() {
  if (stopTimer) {
    clearTimeout(stopTimer);
    stopTimer = null;
  }
  isCrawling = true;
  document.body.classList.add('is-crawling');
  dismissAuthModals();
  if (!authObserver) {
    authObserver = new MutationObserver(() => {
      if (isCrawling) {
        dismissAuthModals();
      }
    });
    authObserver.observe(document.body, { childList: true, subtree: true });
  }
}

function stopCrawlingSession() {
  // Dọn sạch mọi popup phát sinh ở trang cuối cùng
  dismissAuthModals();
  
  // Duy trì observer thêm 3 giây để triệt tiêu các popup sinh trễ do mạng
  if (stopTimer) clearTimeout(stopTimer);
  stopTimer = setTimeout(() => {
    dismissAuthModals();
    isCrawling = false;
    document.body.classList.remove('is-crawling');
    if (authObserver) {
      authObserver.disconnect();
      authObserver = null;
    }
  }, 3000);
}

async function scrollAndLoadMore(pages, targetLimit = null, timeout = 180000) {
  console.log(`Bắt đầu crawl ${pages} trang...`);
  const start = Date.now();
  let currentPage = 0;

  const statusLabel = document.getElementById('statusLabel');
  if (statusLabel) {
    statusLabel.className = 'running';
    statusLabel.textContent = targetLimit 
      ? `⏳ Đang tải trang 1/${pages}...`
      : `⏳ Đang tải trang 1/${pages}...`;
  }

  while (currentPage < pages && Date.now() - start < timeout) {
    dismissAuthModals();
    window.scrollTo(0, document.body.scrollHeight);
    console.log(`Đã cuộn xuống cuối trang ${currentPage + 1}`);
    await new Promise(resolve => setTimeout(resolve, 1500));
    dismissAuthModals();

    const loadMoreButton = document.querySelector('button[data-test="load-more"]');
    if (loadMoreButton && !loadMoreButton.disabled) {
      console.log(`Tìm thấy nút "Show more jobs" cho trang ${currentPage + 1}, đang nhấn...`);
      loadMoreButton.click();
      await new Promise(resolve => setTimeout(resolve, 2000));
      dismissAuthModals();
    } else {
      console.log(`Không tìm thấy nút "Show more jobs" ở trang ${currentPage + 1}, có thể đã tải hết`);
      break;
    }
    currentPage++;
    if (statusLabel && currentPage < pages) {
      statusLabel.textContent = `⏳ Đang tải trang ${currentPage + 1}/${pages}...`;
    }
    if (currentPage === pages) console.log('Đã crawl đủ số trang yêu cầu');
  }

  dismissAuthModals();
  const jobCards = document.querySelectorAll('li[data-test="jobListing"], div[class="JobCard_jobCardContainer__arQlW"], div[class*="jobCardContainer"]');
  if (jobCards.length === 0) {
    throw new Error('Không tìm thấy việc làm nào. Hãy đảm bảo bạn đang ở trang danh sách kết quả tìm kiếm việc làm.');
  }
  console.log(`Tìm thấy ${jobCards.length} job card sau ${Date.now() - start}ms`);
  return jobCards;
}

let currentCrawlMode = 'pages';

function updateModeUI(mode, countVal) {
  currentCrawlMode = mode;
  const modeBtns = document.querySelectorAll('.mode-btn');
  modeBtns.forEach(btn => btn.classList.toggle('active', btn.dataset.mode === mode));

  const inputLabel = document.getElementById('inputLabel');
  const countInput = document.getElementById('countInput');
  const statusLabel = document.getElementById('statusLabel');

  if (mode === 'pages') {
    if (inputLabel) inputLabel.textContent = 'Số trang:';
    if (countInput) {
      countInput.value = countVal || 1;
      countInput.min = '1';
      countInput.max = '50';
      countInput.step = '1';
    }
    if (statusLabel && !isCrawling) {
      statusLabel.className = '';
      statusLabel.textContent = 'trang';
    }
  } else {
    if (inputLabel) inputLabel.textContent = 'Số jobs:';
    if (countInput) {
      countInput.value = countVal || 30;
      countInput.min = '1';
      countInput.max = '1000';
      countInput.step = '10';
    }
    if (statusLabel && !isCrawling) {
      statusLabel.className = '';
      statusLabel.textContent = 'jobs';
    }
  }
}

function updatePageCountDisplay() {
  chrome.storage.local.get(['crawlMode', 'pageCount', 'jobCount'], (result) => {
    const mode = result.crawlMode || 'pages';
    const val = mode === 'pages' ? (parseInt(result.pageCount, 10) || 1) : (parseInt(result.jobCount, 10) || 30);
    updateModeUI(mode, val);
  });
}

function initializeCrawler() {
  console.log('Khởi tạo crawler...');
  const crawlContainer = document.createElement('div');
  crawlContainer.className = 'crawl-container';

  const crawlButton = document.createElement('button');
  crawlButton.id = 'crawlButton';
  crawlButton.innerHTML = '⬇ Crawl Jobs (CSV)';
  crawlButton.setAttribute('aria-label', 'Crawl danh sách việc làm ra file CSV');

  // Cần gạt chuyển đổi chế độ Trang / Jobs
  const modeToggle = document.createElement('div');
  modeToggle.className = 'mode-toggle';

  const pagesBtn = document.createElement('button');
  pagesBtn.type = 'button';
  pagesBtn.className = 'mode-btn active';
  pagesBtn.dataset.mode = 'pages';
  pagesBtn.textContent = 'Trang';

  const jobsBtn = document.createElement('button');
  jobsBtn.type = 'button';
  jobsBtn.className = 'mode-btn';
  jobsBtn.dataset.mode = 'jobs';
  jobsBtn.textContent = 'Jobs';

  modeToggle.appendChild(pagesBtn);
  modeToggle.appendChild(jobsBtn);

  const switchMode = (mode) => {
    chrome.storage.local.set({ crawlMode: mode }, () => {
      chrome.storage.local.get(['pageCount', 'jobCount'], (res) => {
        const val = mode === 'pages' ? (parseInt(res.pageCount, 10) || 1) : (parseInt(res.jobCount, 10) || 30);
        updateModeUI(mode, val);
      });
    });
  };

  pagesBtn.addEventListener('click', () => switchMode('pages'));
  jobsBtn.addEventListener('click', () => switchMode('jobs'));

  const inputGroup = document.createElement('div');
  inputGroup.className = 'page-input-group';

  const inputLabel = document.createElement('label');
  inputLabel.id = 'inputLabel';
  inputLabel.textContent = 'Số trang:';
  inputLabel.htmlFor = 'countInput';

  const countInput = document.createElement('input');
  countInput.id = 'countInput';
  countInput.type = 'number';
  countInput.value = '1';

  countInput.addEventListener('input', () => {
    let val = parseInt(countInput.value, 10);
    if (isNaN(val) || val < 1) val = 1;
    if (currentCrawlMode === 'pages') {
      chrome.storage.local.set({ pageCount: val });
    } else {
      chrome.storage.local.set({ jobCount: val });
    }
  });

  inputGroup.appendChild(inputLabel);
  inputGroup.appendChild(countInput);

  const statusLabel = document.createElement('span');
  statusLabel.id = 'statusLabel';
  statusLabel.textContent = 'trang';

  crawlContainer.appendChild(crawlButton);
  crawlContainer.appendChild(modeToggle);
  crawlContainer.appendChild(inputGroup);
  crawlContainer.appendChild(statusLabel);
  document.body.appendChild(crawlContainer);

  updatePageCountDisplay();

  crawlButton.addEventListener('click', async () => {
    console.log('Nút crawl được nhấn, đang kiểm tra dữ liệu tìm kiếm...');

    // Tìm 2 ô tìm kiếm theo ảnh (Find your perfect job & City, state...)
    const keywordInput = document.querySelector('input[placeholder*="Find your perfect job" i], input[id*="jobTitle" i], input[data-test="search-bar-keyword-input"]');
    const locationInput = document.querySelector('input[placeholder*="City, state" i], input[id*="location" i], input[data-test="search-bar-location-input"]');

    const keywordVal = keywordInput?.value?.trim() || '';
    const locationVal = locationInput?.value?.trim() || '';
    const initialJobs = document.querySelectorAll('li[data-test="jobListing"], div[class*="jobCardContainer"], [class*="JobCard"]');

    // 1. Trường hợp chưa nhập thông tin tìm kiếm
    if (!keywordVal && !locationVal && initialJobs.length === 0) {
      if (keywordInput) {
        keywordInput.focus();
        keywordInput.style.outline = '2px solid #ff4d4f';
        setTimeout(() => { keywordInput.style.outline = ''; }, 3000);
      }
      alert('Vui lòng nhập tên công việc ("Find your perfect job") hoặc địa điểm tìm kiếm trước khi Crawl!');
      return;
    }

    // 2. Trường hợp đã nhập nhưng chưa nhấn tìm kiếm (vẫn ở trang chủ chưa có kết quả)
    if (initialJobs.length === 0 || window.location.pathname.toLowerCase().endsWith('/index.htm')) {
      alert('Vui lòng nhấn Enter hoặc nút Tìm kiếm (Search) trên thanh tìm kiếm để tải danh sách việc làm trước khi Crawl!');
      return;
    }

    chrome.storage.local.get(['crawlMode', 'pageCount', 'jobCount'], async (result) => {
      const mode = result.crawlMode || currentCrawlMode || 'pages';
      let targetPages = 1;
      let targetJobs = null;

      if (mode === 'pages') {
        targetPages = parseInt(result.pageCount, 10) || 1;
        console.log(`Đang crawl theo chế độ TRANG: ${targetPages} trang...`);
      } else {
        targetJobs = parseInt(result.jobCount, 10) || 30;
        targetPages = Math.ceil(targetJobs / 30);
        console.log(`Đang crawl theo chế độ JOBS: ${targetJobs} jobs (cần cuộn ${targetPages} trang)...`);
      }

      startCrawlingSession();
      crawlButton.disabled = true;
      crawlButton.textContent = 'Đang crawl...';

      try {
        const jobElements = await scrollAndLoadMore(targetPages, targetJobs);
        console.log('Bắt đầu trích xuất việc làm...');
        let jobs = [['Company Name', 'Job Title', 'Link', 'Salary', 'Location', 'Date Posted', 'Easy Apply']]; // Thêm header cho CSV
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
            const linkElement = job.querySelector('a[data-test="job-link"]') || job.querySelector('a[href*="/partner/jobListing.htm"]');
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

            // Trích xuất với selector có fallback
            date_post = job.querySelector('div[class*="JobCard_listingAge"], div[class*="listingAge"]')?.textContent.trim() 
              || Array.from(job.querySelectorAll('span, div')).find(el => el.children.length === 0 && /^\s*(\d+[dhwm]|Just posted|Today)\s*$/i.test(el.textContent))?.textContent.trim() 
              || 'N/A';
            
            company_name = job.querySelector('span[class*="EmployerProfile_compactEmployerName"], [data-test="emp-name"], span[class*="employerName"]')?.textContent.trim() || 'N/A';
            location = job.querySelector('div[class*="JobCard_location"], [data-test="emp-location"], div[class*="location"]')?.textContent.trim() || 'N/A';
            job_title = job.querySelector('a[class*="JobCard_jobTitle"], a[data-test="job-link"], [data-test="job-title"]')?.textContent.trim() || 'N/A';
            salary = job.querySelector('div[class*="JobCard_salaryEstimate"], [data-test="detailSalary"], div[class*="salary"]')?.textContent.trim() || 'N/A';
            easy_apply = job.querySelector('div[class*="JobCard_easyApplyTag"], [data-test="easy-apply-tag"]') ? 'Yes' : 'No';

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

        // Nếu ở chế độ số jobs: cắt chính xác số lượng yêu cầu
        if (mode === 'jobs' && targetJobs && jobs.length - 1 > targetJobs) {
          jobs = [jobs[0], ...jobs.slice(1, targetJobs + 1)];
        }

        try {
          if (jobs.length === 1) {
            console.error('Không tìm thấy việc làm hợp lệ để lưu vào CSV');
            alert('Không tìm thấy việc làm hợp lệ để lưu vào CSV.');
            return;
          }
          // Lấy số job hợp lệ (trừ header)
          const validJobCount = jobs.length - 1;
          // Lấy title của trang web, loại bỏ tất cả số và dấu gạch dưới ở đầu
          let fileTitle = document.title.replace(/^\d+(?:_\d+)*_/, '');
          fileTitle = fileTitle.replace(/[\/\\:\*\?"<>\|]/g, '_');
          fileTitle = encodeURIComponent(fileTitle).replace(/%[0-9A-F]{2}/gi, '_');
          const csvContent = jobs.map(row => row.map(cell => {
            if (typeof cell === 'string' && (cell.startsWith('https://') || cell.startsWith('http://'))) {
              return cell;
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
          console.log(`Đã crawl ${validJobCount} việc làm và lưu vào CSV!`);
          crawlButton.innerHTML = '⬇ Crawl tiếp';
          const statusLabel = document.getElementById('statusLabel');
          if (statusLabel) {
            statusLabel.className = 'success';
            statusLabel.textContent = `✓ Đã lưu ${validJobCount} jobs!`;
            setTimeout(() => {
              updatePageCountDisplay();
            }, 5000);
          }
        } catch (e) {
          console.error(`Lỗi tạo CSV: ${e.message}`);
          crawlButton.textContent = 'Lỗi tạo CSV';
        }
      } catch (err) {
        console.error(`Crawl thất bại: ${err.message}`);
        crawlButton.textContent = 'Crawl thất bại';
      } finally {
        stopCrawlingSession();
        crawlButton.disabled = false;
        if (!crawlButton.innerHTML.includes('Crawl tiếp') && !crawlButton.textContent.includes('thất bại')) {
          crawlButton.innerHTML = '⬇ Crawl Jobs (CSV)';
        }
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