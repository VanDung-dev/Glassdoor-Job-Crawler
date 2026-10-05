/**
 * Glassdoor Job Crawler - Main UI & Controller
 * Quản lý giao diện, sự kiện người dùng và điều phối các tác vụ crawl.
 */

let currentCrawlMode = 'pages';

function updateModeUI(mode, countVal) {
  currentCrawlMode = mode;
  const modeBtns = document.querySelectorAll('.mode-btn');
  modeBtns.forEach((btn) => btn.classList.toggle('active', btn.dataset.mode === mode));

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
    if (statusLabel && !statusLabel.classList.contains('running')) {
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
    if (statusLabel && !statusLabel.classList.contains('running')) {
      statusLabel.className = '';
      statusLabel.textContent = 'jobs';
    }
  }
}

function updatePageCountDisplay() {
  chrome.storage.local.get(['crawlMode', 'pageCount', 'jobCount'], (result) => {
    const mode = result.crawlMode || 'pages';
    const val =
      mode === 'pages'
        ? parseInt(result.pageCount, 10) || 1
        : parseInt(result.jobCount, 10) || 30;
    updateModeUI(mode, val);
  });
}

function initializeCrawler() {
  console.log('Khởi tạo Glassdoor Crawler UI...');
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
        const val =
          mode === 'pages'
            ? parseInt(res.pageCount, 10) || 1
            : parseInt(res.jobCount, 10) || 30;
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

  // Nút tạm dừng / tiếp tục phiên crawl
  const pauseButton = document.createElement('button');
  pauseButton.id = 'pauseButton';
  pauseButton.type = 'button';
  pauseButton.innerHTML = '⏸ Tạm dừng';
  pauseButton.setAttribute('aria-label', 'Tạm dừng hoặc tiếp tục quá trình crawl');

  pauseButton.addEventListener('click', () => {
    if (!CrawlerUtils.getIsPaused()) {
      CrawlerUtils.pauseCrawling();
      pauseButton.classList.add('is-paused');
      pauseButton.innerHTML = '▶ Tiếp tục';
      if (statusLabel) {
        statusLabel.className = 'running';
        statusLabel.textContent = '⏸ Đã tạm dừng';
      }
    } else {
      CrawlerUtils.resumeCrawling();
      pauseButton.classList.remove('is-paused');
      pauseButton.innerHTML = '⏸ Tạm dừng';
      if (statusLabel) {
        statusLabel.className = 'running';
        statusLabel.textContent = '⏳ Đang tiếp tục...';
      }
    }
  });

  crawlContainer.appendChild(crawlButton);
  crawlContainer.appendChild(pauseButton);
  crawlContainer.appendChild(modeToggle);
  crawlContainer.appendChild(inputGroup);
  crawlContainer.appendChild(statusLabel);
  document.body.appendChild(crawlContainer);

  updatePageCountDisplay();

  // Tự động kích hoạt crawl nếu vừa chuyển hướng từ tìm kiếm tự động
  if (sessionStorage.getItem('autoStartCrawl') === 'true') {
    console.log('Phát hiện yêu cầu tự động crawl sau khi tải trang kết quả...');
    let checkAttempts = 0;
    const autoInterval = setInterval(() => {
      checkAttempts++;
      const currentCards = document.querySelectorAll(
        'li[data-test="jobListing"], div[class*="jobCardContainer"], [class*="JobCard"]'
      );
      if (currentCards.length > 0) {
        clearInterval(autoInterval);
        sessionStorage.removeItem('autoStartCrawl');
        console.log(`Tìm thấy ${currentCards.length} việc làm, tự động bắt đầu crawl...`);
        crawlButton.click();
      } else if (checkAttempts > 30) {
        clearInterval(autoInterval);
        sessionStorage.removeItem('autoStartCrawl');
      }
    }, 500);
  }

  // Sự kiện khi bấm nút Crawl Jobs
  crawlButton.addEventListener('click', async () => {
    console.log('Nút crawl được nhấn, đang kiểm tra dữ liệu tìm kiếm...');

    const jobInput =
      document.getElementById('searchBar-jobTitle') ||
      document.querySelector('input[name="sc.keyword"]') ||
      document.querySelector('input[data-test="search-bar-keyword-input"]') ||
      document.querySelector('input[placeholder*="Find your perfect job" i]') ||
      document.querySelector('input[placeholder*="Job title" i]');

    const locationInput =
      document.getElementById('searchBar-location') ||
      document.querySelector('input[name="locKeyword"]') ||
      document.querySelector('input[data-test="search-bar-location-input"]') ||
      document.querySelector('input[placeholder*="City, state" i]') ||
      document.querySelector('input[placeholder*="remote" i]');

    const jobVal = jobInput?.value?.trim() || '';
    const locationVal = locationInput?.value?.trim() || '';
    const initialJobs = document.querySelectorAll(
      'li[data-test="jobListing"], div[class*="jobCardContainer"], [class*="JobCard"]'
    ).length;

    // Nếu chưa có kết quả hoặc đang ở trang index: bắt buộc nhập đủ 2 trường
    if (initialJobs === 0 || window.location.pathname.toLowerCase().endsWith('/index.htm')) {
      if (!jobVal && !locationVal) {
        CrawlerUtils.showInputTooltip(
          jobInput,
          '⚠️ Vui lòng nhập tên công việc và thành phố/địa điểm!'
        );
        if (locationInput) {
          locationInput.classList.add('crawler-highlight-input');
          locationInput.addEventListener(
            'input',
            () => locationInput.classList.remove('crawler-highlight-input'),
            { once: true }
          );
        }
        return;
      }

      if (!jobVal) {
        CrawlerUtils.showInputTooltip(jobInput, '⚠️ Vui lòng nhập tên công việc ("Find your perfect job")!');
        return;
      }

      if (!locationVal) {
        CrawlerUtils.showInputTooltip(
          locationInput,
          '⚠️ Vui lòng nhập thêm thành phố/địa điểm ("City, state, zipcode, or remote")!'
        );
        return;
      }

      // Đã đủ cả 2 trường: điều hướng sang trang kết quả và chuẩn bị crawl
      console.log(`Đã đủ thông tin: Job="${jobVal}", Location="${locationVal}". Đang kích hoạt tìm kiếm...`);
      CrawlerUtils.showInputTooltip(
        jobInput,
        '🔍 Đã đủ thông tin! Đang tự động tìm kiếm và chuẩn bị crawl...',
        true
      );

      crawlButton.disabled = true;
      crawlButton.textContent = '⏳ Đang tìm kiếm...';
      sessionStorage.setItem('autoStartCrawl', 'true');

      const enterDown = new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true });
      const enterUp = new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true });
      if (locationInput) {
        locationInput.dispatchEvent(enterDown);
        locationInput.dispatchEvent(enterUp);
      }
      if (jobInput) {
        jobInput.dispatchEvent(enterDown);
        jobInput.dispatchEvent(enterUp);
      }

      const targetUrl = `https://www.glassdoor.com/Job/jobs.htm?sc.keyword=${encodeURIComponent(jobVal)}&locKeyword=${encodeURIComponent(locationVal)}`;
      console.log(`Điều hướng trực tiếp tới: ${targetUrl}`);
      setTimeout(() => {
        window.location.href = targetUrl;
      }, 200);
      return;
    }

    // Bắt đầu quá trình Crawl dữ liệu việc làm
    chrome.storage.local.get(['crawlMode', 'pageCount', 'jobCount'], async (result) => {
      const mode = result.crawlMode || currentCrawlMode || 'pages';
      let targetPages = 1;
      let targetJobs = null;

      if (mode === 'pages') {
        targetPages = parseInt(result.pageCount, 10) || 1;
        console.log(`Crawl chế độ TRANG: ${targetPages} trang...`);
      } else {
        targetJobs = parseInt(result.jobCount, 10) || 30;
        targetPages = Math.ceil(targetJobs / 30);
        console.log(`Crawl chế độ JOBS: ${targetJobs} jobs (~${targetPages} trang)...`);
      }

      CrawlerUtils.startCrawlingSession();
      crawlButton.disabled = true;
      crawlButton.textContent = 'Đang crawl...';
      pauseButton.style.display = 'inline-flex';
      pauseButton.classList.remove('is-paused');
      pauseButton.innerHTML = '⏸ Tạm dừng';

      try {
        const jobElements = await CrawlerUtils.scrollAndLoadMore(
          targetPages,
          targetJobs,
          (curr, total) => {
            if (statusLabel && !CrawlerUtils.getIsPaused()) {
              statusLabel.className = 'running';
              statusLabel.textContent = `⏳ Đang tải trang ${curr}/${total}...`;
            }
          }
        );

        console.log('Trích xuất dữ liệu việc làm...');
        const jobs = CrawlerUtils.extractJobs(jobElements, mode === 'jobs' ? targetJobs : null);
        const validJobCount = CrawlerUtils.downloadCsv(jobs);

        console.log(`Đã xuất ${validJobCount} việc làm ra CSV!`);
        crawlButton.innerHTML = '⬇ Crawl tiếp';
        if (statusLabel) {
          statusLabel.className = 'success';
          statusLabel.textContent = `✓ Đã lưu ${validJobCount} jobs!`;
          setTimeout(() => updatePageCountDisplay(), 5000);
        }
      } catch (err) {
        console.error(`Crawl thất bại: ${err.message}`);
        crawlButton.textContent = 'Crawl thất bại';
      } finally {
        CrawlerUtils.stopCrawlingSession();
        crawlButton.disabled = false;
        pauseButton.style.display = 'none';
        pauseButton.classList.remove('is-paused');
        if (
          !crawlButton.innerHTML.includes('Crawl tiếp') &&
          !crawlButton.textContent.includes('thất bại')
        ) {
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
    updatePageCountDisplay();
    sendResponse({ status: 'updated' });
  }
});