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
  pauseButton.disabled = true;
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

  // Nút mũi tên gạt nằm chính giữa đỉnh thẻ mặc định (Handle Tab kiểu App)
  const advHandle = document.createElement('div');
  advHandle.className = 'crawl-drawer-handle';
  advHandle.id = 'advDrawerHandle';
  advHandle.title = 'Bấm để mở rộng / thu gọn bộ lọc nâng cao';
  advHandle.innerHTML = `
    <span class="handle-pill">
      <svg class="handle-chevron-icon" width="16" height="10" viewBox="0 0 16 10" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M2 8L8 2L14 8" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>
    </span>
  `;

  // Khung mở rộng nâng cao tích hợp bên trong thẻ chính (Drawer)
  const advDrawer = document.createElement('div');
  advDrawer.className = 'crawl-expandable-drawer';
  advDrawer.innerHTML = `
    <div class="drawer-header">
      <h4>⚙ Bộ lọc nâng cao</h4>
      <button type="button" class="drawer-close-btn" aria-label="Thu gọn">✕</button>
    </div>

    <div class="drawer-body">
      <div class="crw-filter-row">
        <span class="crw-filter-label">⚡ Easy Apply only:</span>
        <label class="crw-toggle-switch">
          <input type="checkbox" id="advEasyApply">
          <span class="crw-toggle-slider"></span>
        </label>
      </div>

      <div class="crw-filter-row">
        <span class="crw-filter-label">🏠 Remote only:</span>
        <label class="crw-toggle-switch">
          <input type="checkbox" id="advRemote">
          <span class="crw-toggle-slider"></span>
        </label>
      </div>

      <div class="crw-filter-row">
        <span class="crw-filter-label">💰 Chỉ việc có lương:</span>
        <label class="crw-toggle-switch">
          <input type="checkbox" id="advHasSalary">
          <span class="crw-toggle-slider"></span>
        </label>
      </div>

      <div class="crw-filter-row">
        <span class="crw-filter-label">📅 Ngày đăng:</span>
        <select id="advDatePosted" class="crw-filter-select">
          <option value="">Mọi lúc</option>
          <option value="1">24 giờ qua</option>
          <option value="3">3 ngày qua</option>
          <option value="7">1 tuần qua</option>
          <option value="14">2 tuần qua</option>
          <option value="30">1 tháng qua</option>
        </select>
      </div>

      <div class="crw-filter-row">
        <span class="crw-filter-label">⭐ Đánh giá công ty:</span>
        <select id="advRating" class="crw-filter-select">
          <option value="">Mọi mức</option>
          <option value="4.0">★★★★☆ (4.0+)</option>
          <option value="3.0">★★★☆☆ (3.0+)</option>
          <option value="2.0">★★☆☆☆ (2.0+)</option>
        </select>
      </div>

      <div class="crw-filter-row">
        <span class="crw-filter-label">💵 Lương tối thiểu ($k/năm):</span>
        <input type="number" id="advMinSalary" class="crw-filter-input" placeholder="Ví dụ: 70" min="0" step="5">
      </div>

      <div class="crw-filter-row" style="flex-direction: column; align-items: flex-start; gap: 6px;">
        <span class="crw-filter-label">🚫 Loại trừ từ khóa tiêu đề:</span>
        <input type="text" id="advExcludeKeywords" class="crw-filter-input" style="width: 100% !important; box-sizing: border-box !important;" placeholder="Ví dụ: Senior, Lead, Manager">
      </div>
    </div>

    <div class="drawer-footer">
      <span>Tự động lưu & áp dụng</span>
      <button type="button" class="reset-adv-btn" id="resetAdvBtn">Đặt lại</button>
    </div>
  `;

  // Thanh công cụ mặc định (hàng dưới)
  const mainBar = document.createElement('div');
  mainBar.className = 'crawl-main-bar';
  mainBar.appendChild(crawlButton);
  mainBar.appendChild(pauseButton);
  mainBar.appendChild(modeToggle);
  mainBar.appendChild(inputGroup);
  mainBar.appendChild(statusLabel);

  // Ghép cả Handle, Drawer và MainBar vào cùng 1 container duy nhất
  crawlContainer.appendChild(advHandle);
  crawlContainer.appendChild(advDrawer);
  crawlContainer.appendChild(mainBar);
  document.body.appendChild(crawlContainer);

  const advFields = {
    advEasyApply: advDrawer.querySelector('#advEasyApply'),
    advRemote: advDrawer.querySelector('#advRemote'),
    advHasSalary: advDrawer.querySelector('#advHasSalary'),
    advDatePosted: advDrawer.querySelector('#advDatePosted'),
    advRating: advDrawer.querySelector('#advRating'),
    advMinSalary: advDrawer.querySelector('#advMinSalary'),
    advExcludeKeywords: advDrawer.querySelector('#advExcludeKeywords'),
  };

  const updateAdvBadge = (settings) => {
    const hasActiveFilters = Boolean(
      settings.advEasyApply ||
      settings.advRemote ||
      settings.advHasSalary ||
      settings.advDatePosted ||
      settings.advRating ||
      (settings.advMinSalary && parseInt(settings.advMinSalary, 10) > 0) ||
      (settings.advExcludeKeywords && settings.advExcludeKeywords.trim())
    );
    advHandle.classList.toggle('has-filters', hasActiveFilters);
  };

  const loadAdvSettings = () => {
    chrome.storage.local.get([
      'advEasyApply', 'advRemote', 'advHasSalary',
      'advDatePosted', 'advRating', 'advMinSalary', 'advExcludeKeywords',
      'advPanelExpanded'
    ], (res) => {
      advFields.advEasyApply.checked = Boolean(res.advEasyApply);
      advFields.advRemote.checked = Boolean(res.advRemote);
      advFields.advHasSalary.checked = Boolean(res.advHasSalary);
      advFields.advDatePosted.value = res.advDatePosted || '';
      advFields.advRating.value = res.advRating || '';
      advFields.advMinSalary.value = res.advMinSalary || '';
      advFields.advExcludeKeywords.value = res.advExcludeKeywords || '';
      updateAdvBadge(res);

      if (res.advPanelExpanded) {
        crawlContainer.classList.add('is-expanded');
      }
    });
  };

  const saveAdvSettings = () => {
    const settings = {
      advEasyApply: advFields.advEasyApply.checked,
      advRemote: advFields.advRemote.checked,
      advHasSalary: advFields.advHasSalary.checked,
      advDatePosted: advFields.advDatePosted.value,
      advRating: advFields.advRating.value,
      advMinSalary: advFields.advMinSalary.value,
      advExcludeKeywords: advFields.advExcludeKeywords.value,
    };
    chrome.storage.local.set(settings, () => {
      updateAdvBadge(settings);
    });
  };

  Object.values(advFields).forEach((field) => {
    field.addEventListener('change', saveAdvSettings);
    if (field.tagName === 'INPUT' && field.type === 'text') {
      field.addEventListener('input', saveAdvSettings);
    }
  });

  // Bấm vào nút gạt trên đỉnh để mở rộng / thu gọn
  advHandle.addEventListener('click', (e) => {
    e.stopPropagation();
    const isNowExpanded = crawlContainer.classList.toggle('is-expanded');
    chrome.storage.local.set({ advPanelExpanded: isNowExpanded });
  });

  advDrawer.querySelector('.drawer-close-btn').addEventListener('click', (e) => {
    e.stopPropagation();
    crawlContainer.classList.remove('is-expanded');
    chrome.storage.local.set({ advPanelExpanded: false });
  });

  advDrawer.querySelector('#resetAdvBtn').addEventListener('click', () => {
    advFields.advEasyApply.checked = false;
    advFields.advRemote.checked = false;
    advFields.advHasSalary.checked = false;
    advFields.advDatePosted.value = '';
    advFields.advRating.value = '';
    advFields.advMinSalary.value = '';
    advFields.advExcludeKeywords.value = '';
    saveAdvSettings();
  });

  loadAdvSettings();

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

      chrome.storage.local.get([
        'advEasyApply', 'advRemote', 'advHasSalary',
        'advDatePosted', 'advRating', 'advMinSalary', 'advExcludeKeywords'
      ], (advRes) => {
        const targetUrl = CrawlerUtils.buildSearchUrl(jobVal, locationVal, advRes);
        console.log(`Điều hướng trực tiếp kèm bộ lọc nâng cao: ${targetUrl}`);
        setTimeout(() => {
          window.location.href = targetUrl;
        }, 200);
      });
      return;
    }

    // Bắt đầu quá trình Crawl dữ liệu việc làm
    chrome.storage.local.get([
      'crawlMode', 'pageCount', 'jobCount',
      'advEasyApply', 'advRemote', 'advHasSalary',
      'advDatePosted', 'advRating', 'advMinSalary', 'advExcludeKeywords'
    ], async (result) => {
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
      pauseButton.disabled = false;
      pauseButton.classList.remove('is-paused');
      pauseButton.innerHTML = '⏸ Tạm dừng';

      try {
        const isJobMode = mode === 'jobs';
        const jobElements = await CrawlerUtils.scrollAndLoadMore(
          targetPages,
          isJobMode ? targetJobs : null,
          (curr, total) => {
            if (statusLabel && !CrawlerUtils.getIsPaused()) {
              statusLabel.className = 'running';
              statusLabel.textContent = isJobMode
                ? `⏳ Đã tìm ${curr}/${total} jobs...`
                : `⏳ Đang tải trang ${curr}/${total}...`;
            }
          },
          result
        );

        console.log('Trích xuất dữ liệu việc làm...');
        const jobs = CrawlerUtils.extractJobs(jobElements, mode === 'jobs' ? targetJobs : null, result);
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
        pauseButton.disabled = true;
        pauseButton.classList.remove('is-paused');
        pauseButton.innerHTML = '⏸ Tạm dừng';
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