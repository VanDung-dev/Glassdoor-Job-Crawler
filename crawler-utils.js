/**
 * Glassdoor Job Crawler - Utility & Scraping Module
 * Chứa các hàm xử lý phụ trợ: quản lý popup, cuộn trang, trích xuất dữ liệu việc làm và xuất CSV.
 */

window.CrawlerUtils = (function () {
  let isCrawling = false;
  let isPaused = false;
  let authObserver = null;
  let stopTimer = null;

  function pauseCrawling() {
    isPaused = true;
    console.log('Quá trình crawl đã tạm dừng.');
  }

  function resumeCrawling() {
    isPaused = false;
    console.log('Quá trình crawl tiếp tục.');
  }

  function getIsPaused() {
    return isPaused;
  }

  // Regex rộng cho text "Date Posted" của Glassdoor:
  // Hỗ trợ dạng rút gọn ("5d", "30d+", "24h", "1w", "1y", "4mo", "30 d"),
  // dạng chữ ("3 days ago", "2 weeks ago", "Posted 3d ago", "Just posted", "Today", "Yesterday"),
  // và chuẩn ISO Date ("2026-10-14").
  const DATE_POSTED_RE =
    /^\s*(just posted|today|yesterday|posted\s+.+|\d{4}-\d{2}-\d{2}|\d+\s*(h|hr|hrs|hours?)\s*(ago)?|\d+\s*(d|day|days?)\+?\s*(ago)?|\d+\s*(w|wk|wks|weeks?)\+?\s*(ago)?|\d+\s*(mo|mos|months?)\+?\s*(ago)?|\d+\s*(y|yr|yrs|years?)\+?\s*(ago)?|\d+\s*[hdwmy]\+?\s*(ago)?)\s*$/i;

  function isDatePostedText(text) {
    if (!text) return false;
    const t = String(text).trim();
    // Loại chuỗi quá dài (mô tả job) để tránh match nhầm "posted ..." trong đoạn văn
    if (t.length > 40) return false;
    return DATE_POSTED_RE.test(t);
  }

  // Chuẩn hóa "6\nD" / "6 D" / "30 d" -> "6D" / "30d" và cắt ISO timestamp -> "YYYY-MM-DD"
  function normalizeDatePosted(text) {
    if (!text) return 'N/A';
    let t = String(text).replace(/\s+/g, ' ').trim();
    if (/^\d{4}-\d{2}-\d{2}/.test(t)) return t.slice(0, 10);
    t = t.replace(/(\d)\s+([hdwmyHDWMY]\b)/g, '$1$2');
    return t;
  }

  // Từ đơn vị dạng chữ đầy đủ đứng một mình ("1 year", "3 days") hầu như luôn là
  // mảnh mô tả ("1 year of experience"), không phải tuổi tin -> loại.
  // Glassdoor viết gọn "4mo", "3d", "2w", "1y" nên các dạng này vẫn nhận.
  function isBareWordUnit(text) {
    return /^\s*\d+\s*(hours?|days?|weeks?|months?|years?|hrs?|wks?)\s*$/i.test(text);
  }

  // Trích xuất Date Posted bền vững, không phụ thuộc hash CSS Glassdoor.
  // Thứ tự: (1) selector chuyên dụng mọi tag, (2) time/data-test/aria-label,
  // (3) quét MỌI element lấy match ngắn nhất (bắt cả trường hợp số và đơn vị
  // nằm ở 2 child riêng lẻ, ví dụ <div>6<span>D</span></div> -> textContent "6D"),
  // (4) quét text toàn card.
  function getDatePosted(job) {
    if (!job || !job.querySelector) return 'N/A';
    try {
      // Selector chuyên dụng (DOM thật & các biến thể Glassdoor):
      const dedicated =
        job.querySelector('time[data-test="RelativeDate-time"], [data-test*="RelativeDate"]') ||
        job.querySelector('[class*="relative-date"], [class*="relativeDate"]') ||
        job.querySelector('[class*="listingAge"], [class*="ListingAge"]') ||
        job.querySelector('time, [data-test*="listing-age" i], [data-test*="age" i], [data-test*="job-age" i], [data-test*="pub-date" i]');
      if (dedicated) {
        // time có datetime nhưng rỗng text -> lấy phần ngày (ưu tiên trước text).
        if (dedicated.tagName === 'TIME' && dedicated.getAttribute) {
          const dt = dedicated.getAttribute('datetime');
          const t = (dedicated.textContent || '').trim();
          if (!t && dt && /^\d{4}-\d{2}-\d{2}/.test(dt)) return normalizeDatePosted(dt.slice(0, 10));
        }
      }
      if (dedicated && dedicated.textContent && dedicated.textContent.trim()) {
        const t = dedicated.textContent.trim();
        if (t.length <= 40 && (isDatePostedText(t) || /listingage|relative-?date/i.test(dedicated.className?.toString?.() || '') || (dedicated.getAttribute && dedicated.getAttribute('data-test') === 'RelativeDate-time'))) {
          return normalizeDatePosted(t);
        }
        // time text lạ nhưng có datetime hợp lệ -> lấy phần ngày
        if (dedicated.tagName === 'TIME' && dedicated.getAttribute) {
          const dt = dedicated.getAttribute('datetime');
          if (dt && /^\d{4}-\d{2}-\d{2}/.test(dt)) return normalizeDatePosted(dt.slice(0, 10));
        }
      }

      // Kiểm tra aria-label / title / datetime (Glassdoor đôi khi để tuổi tin ở attribute)
      const attrEl = job.querySelector('[aria-label], time[datetime], [title]');
      if (attrEl) {
        for (const attr of ['aria-label', 'title', 'datetime']) {
          const v = attrEl.getAttribute && attrEl.getAttribute(attr);
          if (v && isDatePostedText(v)) return normalizeDatePosted(v);
        }
      }

      // Quét mọi element, ưu tiên match NGẮN nhất để bắt cả parent có children.
      const all = job.querySelectorAll('span, div, time, li, p');
      let best = null;
      for (const el of all) {
        const t = (el.textContent || '').trim();
        if (!t || t.length > 40) continue;
        if (isDatePostedText(t) && !isBareWordUnit(t)) {
          if (!best || t.length < best.length) best = t;
        }
      }
      if (best) return normalizeDatePosted(best);

      // Fallback cuối: chỉ chấp nhận khi đứng ở ngữ cảnh ngày đăng (sau "posted",
      // kẹp giữa dấu phân cách footer, hoặc kèm "ago") để không nuốt
      // "1 year of experience" hay "3D printing" trong mô tả.
      const fullText = (job.innerText || job.textContent || '').replace(/\s+/g, ' ');
      const loosePatterns = [
        /posted\s+((?:just now|today|yesterday|\d{4}-\d{2}-\d{2}|\d+\s*(?:[hdwmy]\+?|hours?|days?|weeks?|months?|years?|hrs?|wks?|mos?|yrs?)(?:\s*ago)?))/i,
        /(?:^|[•|·\-–—({\[])\s*((?:just posted|today|yesterday|\d+\s*[hdwmy]\+?|\d+\s*mo\+?)(?:\s*ago)?)\s*(?:$|[•|·\-–—)}\]])/i,
        /\b(\d+\s*(?:hours?|days?|weeks?|months?|years?)\s+ago)\b/i,
      ];
      for (const re of loosePatterns) {
        const hit = fullText.match(re);
        if (hit && isDatePostedText(hit[1]) && !isBareWordUnit(hit[1])) {
          return normalizeDatePosted(hit[1]);
        }
      }
    } catch (e) {}
    return 'N/A';
  }

  // Nguồn 2: Bóc tách cấu trúc JSON nhúng trong trang (Next.js, Apollo Client Cache, Schema.org JSON-LD).
  // Chạy tức thì tại chỗ (0ms), không cần tải lại trang hay đổi URL.
  function buildJobAgeMap() {
    const map = new Map();
    try {
      const put = (id, raw) => {
        if (!id || !raw) return;
        const v = normalizeDatePosted(String(raw).slice(0, 40));
        if (!map.has(String(id)) && isDatePostedText(v)) {
          map.set(String(id), v);
        }
      };

      const putUnit = (id, num, unit) => {
        const u = { HOUR: 'h', DAY: 'd', WEEK: 'w', MONTH: 'mo', YEAR: 'y' }[String(unit || '').toUpperCase()];
        if (u && /^\d+$/.test(String(num))) put(id, num + u);
      };

      const getAgeValue = (obj) => {
        if (!obj || typeof obj !== 'object') return null;

        const candidates = [
          obj.listingAge,
          obj.relativeDateTime,
          obj.relativeDate,
          obj.postedAge,
          obj.ageString,
          obj.formattedAge,
          obj.datePosted,
          obj.publicationDate,
          obj.postedDate,
          obj.timePosted,
        ];
        for (const val of candidates) {
          if (typeof val === 'string' && val.trim()) {
            const v = val.trim();
            if (/^\d{4}-\d{2}-\d{2}/.test(v)) return v.slice(0, 10);
            if (isDatePostedText(v)) return v;
          }
        }

        if (obj.age && typeof obj.age === 'object') {
          const u = { HOUR: 'h', DAY: 'd', WEEK: 'w', MONTH: 'mo', YEAR: 'y' }[String(obj.age.unit || '').toUpperCase()];
          if (u && obj.age.value !== undefined && /^\d+$/.test(String(obj.age.value))) {
            return `${obj.age.value}${u}`;
          }
        } else if (typeof obj.age === 'string' && isDatePostedText(obj.age)) {
          return obj.age;
        }

        if (typeof obj.ageInDays === 'number' && !isNaN(obj.ageInDays)) {
          return `${obj.ageInDays}d`;
        }
        if (typeof obj.ageInHours === 'number' && !isNaN(obj.ageInHours)) {
          return `${obj.ageInHours}h`;
        }

        return null;
      };

      const extractAgesFromJson = (data) => {
        if (!data || typeof data !== 'object') return;
        const stack = [data];
        const seen = new Set();
        let steps = 0;

        while (stack.length > 0 && steps < 50000) {
          steps++;
          const curr = stack.pop();
          if (!curr || typeof curr !== 'object') continue;
          if (seen.has(curr)) continue;
          seen.add(curr);

          let id = null;
          if (curr.jobListingId) id = String(curr.jobListingId);
          else if (curr.listingId) id = String(curr.listingId);
          else if (curr.jobId) id = String(curr.jobId);
          else if (curr.job?.listingId) id = String(curr.job.listingId);
          else if (curr.job?.jobListingId) id = String(curr.job.jobListingId);
          else if (curr.jobview?.job?.listingId) id = String(curr.jobview.job.listingId);
          else if (curr.id && /^\d{8,16}$/.test(String(curr.id))) id = String(curr.id);

          if (Array.isArray(curr)) {
            for (let i = 0; i < curr.length; i++) {
              if (curr[i] && typeof curr[i] === 'object') stack.push(curr[i]);
            }
          } else {
            // Schema.org JobPosting check
            if (curr['@type'] === 'JobPosting') {
              const jpId = curr.identifier?.value || (curr.url && curr.url.match(/jobListingId=(\d+)|jl=(\d+)/)?.[1]);
              const jpDate = curr.datePosted;
              if (jpId && jpDate) put(jpId, jpDate);
            }

            for (const key of Object.keys(curr)) {
              const val = curr[key];
              const keyMatch = key.match(/(?:JobListing|Header|JobOverview|JobView)[:_](\d+)/i);
              if (keyMatch && val && typeof val === 'object') {
                const keyId = keyMatch[1];
                const ageVal = getAgeValue(val);
                if (ageVal) put(keyId, ageVal);
              }
              if (val && typeof val === 'object') {
                stack.push(val);
              }
            }
          }

          if (id) {
            const ageVal = getAgeValue(curr);
            if (ageVal) {
              put(id, ageVal);
            } else {
              if (curr.header && typeof curr.header === 'object') {
                const hAge = getAgeValue(curr.header);
                if (hAge) put(id, hAge);
              }
              if (curr.jobview && typeof curr.jobview === 'object') {
                const jvAge = getAgeValue(curr.jobview);
                if (jvAge) put(id, jvAge);
              }
            }
          }
        }
      };

      const rawChunks = [];
      const scripts = document.querySelectorAll(
        'script#__NEXT_DATA__, script#__APOLLO_STATE__, script[type="application/json"], script[type="application/ld+json"], script:not([src])'
      );

      scripts.forEach((s) => {
        const text = (s.textContent || '').trim();
        if (!text || text.length > 1e7) return;
        rawChunks.push(text);

        const isJsonScript =
          s.id === '__NEXT_DATA__' ||
          s.id === '__APOLLO_STATE__' ||
          (s.getAttribute('type') || '').includes('json');

        if (isJsonScript) {
          try {
            const parsed = JSON.parse(text);
            extractAgesFromJson(parsed);
          } catch (e) {}
        }
      });

      // Lưới bảo hiểm: Quét regex trên chuỗi script nếu JSON parse không bắt được
      const blob = rawChunks.join('\n').slice(0, 15e6);
      if (blob) {
        const GAP = '(?:(?!"jobListingId")[\\s\\S]){0,800}?';
        const nearRe = new RegExp(
          '"jobListingId"\\s*:\\s*"?([0-9]+)"?' + GAP + '"(?:listingAge|age|relativeDate(?:Time)?|postedAge|publicationDate|datePosted)"\\s*:\\s*"?([^",}\\]]{1,30})"?',
          'gi'
        );
        let m;
        while ((m = nearRe.exec(blob))) put(m[1], m[2]);

        const unitRe = new RegExp(
          '"jobListingId"\\s*:\\s*"?([0-9]+)"?' + GAP + '"age"\\s*:\\s*\\{\\s*"value"\\s*:\\s*([0-9]+)\\s*,\\s*"unit"\\s*:\\s*"([A-Z]+)"',
          'gi'
        );
        while ((m = unitRe.exec(blob))) putUnit(m[1], m[2], m[3]);

        const daysRe = new RegExp(
          '"jobListingId"\\s*:\\s*"?([0-9]+)"?' + GAP + '"(?:ageInDays|daysAgo)"\\s*:\\s*([0-9]+)',
          'gi'
        );
        while ((m = daysRe.exec(blob))) put(m[1], `${m[2]}d`);
      }
    } catch (e) {}
    return map;
  }

  // Đóng và gỡ bỏ các dialog/popup bắt đăng nhập của Glassdoor khi đang crawl
  function dismissAuthModals() {
    if (!isCrawling) return;
    const dialogs = document.querySelectorAll(
      'dialog, dialog[open], div[class*="Hardsell"], div[id*="Hardsell"], div[class*="backdrop"]'
    );
    dialogs.forEach((d) => {
      try {
        const closeBtn = d
          .querySelector('button[aria-label*="close" i], button[class*="Close"], svg')
          ?.closest('button');
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

  // Bắt đầu phiên crawl: kích hoạt observer theo dõi popup tự động
  function startCrawlingSession() {
    if (stopTimer) {
      clearTimeout(stopTimer);
      stopTimer = null;
    }
    isCrawling = true;
    isPaused = false;
    document.body.classList.add('is-crawling');
    dismissAuthModals();
    if (!authObserver) {
      authObserver = new MutationObserver(() => {
        if (isCrawling) dismissAuthModals();
      });
      authObserver.observe(document.body, { childList: true, subtree: true });
    }
  }

  // Kết thúc phiên crawl: duy trì bộ dọn dẹp thêm 3 giây để triệt tiêu popup trễ
  function stopCrawlingSession() {
    isPaused = false;
    dismissAuthModals();
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

  // Kiểm tra 1 job card xem có thỏa mãn toàn bộ bộ lọc nâng cao hay không
  function isJobMatchingFilters(job, advFilters = {}) {
    try {
      const linkElement =
        job.querySelector('a[data-test="job-link"]') ||
        job.querySelector('a[href*="/partner/jobListing.htm"]');
      let link_job = linkElement ? linkElement.getAttribute('href') || 'N/A' : 'N/A';

      const company_name =
        job.querySelector(
          'span[class*="EmployerProfile_compactEmployerName"], [data-test="emp-name"], span[class*="employerName"]'
        )?.textContent.trim() || 'N/A';

      const job_title =
        job.querySelector(
          'a[class*="JobCard_jobTitle"], a[data-test="job-link"], [data-test="job-title"]'
        )?.textContent.trim() || 'N/A';

      const location =
        job.querySelector(
          'div[class*="JobCard_location"], [data-test="emp-location"], div[class*="location"]'
        )?.textContent.trim() || 'N/A';

      const salary =
        job.querySelector(
          'div[class*="JobCard_salaryEstimate"], [data-test="detailSalary"], div[class*="salary"]'
        )?.textContent.trim() || 'N/A';

      const date_post = getDatePosted(job);

      const easy_apply = job.querySelector('div[class*="JobCard_easyApplyTag"], [data-test="easy-apply-tag"]')
        ? 'Yes'
        : 'No';

      const isRemoteJob = Boolean(
        /\bremote\b/i.test(location) ||
        /\bremote\b/i.test(job_title) ||
        job.querySelector('[data-test*="remote"], span[class*="remoteWork"]')
      );
      const remote = isRemoteJob ? 'Yes' : 'No';

      const ratingElement =
        job.querySelector('span[class*="rating"], [data-test="rating-value"], span[class*="ratingBox"]') ||
        Array.from(job.querySelectorAll('span, div')).find(
          (el) => el.children.length === 0 && /^\s*\d\.\d\s*★?\s*$/.test(el.textContent.trim())
        );
      const company_rating = ratingElement ? ratingElement.textContent.replace('★', '').trim() : 'N/A';

      if ([link_job, company_name, job_title, salary, location, date_post, easy_apply].every((v) => v === 'N/A')) {
        return false;
      }

      if (advFilters.advEasyApply && easy_apply !== 'Yes') return false;
      if (advFilters.advRemote && remote !== 'Yes') return false;
      if (advFilters.advHasSalary && salary === 'N/A') return false;

      if (advFilters.advExcludeKeywords && advFilters.advExcludeKeywords.trim()) {
        const excludeList = advFilters.advExcludeKeywords
          .split(',')
          .map((k) => k.trim().toLowerCase())
          .filter(Boolean);
        if (excludeList.some((k) => job_title.toLowerCase().includes(k))) return false;
      }

      if (advFilters.advRating && company_rating !== 'N/A') {
        const minRating = parseFloat(advFilters.advRating);
        const currRating = parseFloat(company_rating);
        if (!isNaN(minRating) && !isNaN(currRating) && currRating < minRating) return false;
      }

      return true;
    } catch (e) {
      return false;
    }
  }

  // Đếm số job card hiện có trên DOM thỏa mãn bộ lọc nâng cao (đã khử trùng lặp)
  function countMatchingJobsOnPage(advFilters = {}) {
    const jobCards = document.querySelectorAll(
      'li[data-test="jobListing"], div[class="JobCard_jobCardContainer__arQlW"], div[class*="jobCardContainer"]'
    );
    const seenIds = new Set();
    let matchingCount = 0;

    jobCards.forEach((job) => {
      const linkElement =
        job.querySelector('a[data-test="job-link"]') ||
        job.querySelector('a[href*="/partner/jobListing.htm"]');
      let link_job = linkElement ? linkElement.getAttribute('href') || '' : '';
      const jobIdMatch = link_job.match(/jobListingId=(\d+)/);
      const jobId = jobIdMatch ? jobIdMatch[1] : (job.getAttribute('data-jobid') || null);
      if (jobId && seenIds.has(jobId)) return;
      if (jobId) seenIds.add(jobId);

      if (isJobMatchingFilters(job, advFilters)) {
        matchingCount++;
      }
    });

    return matchingCount;
  }

  // Cuộn trang và bấm nút tải thêm ("Show more jobs")
  // Nếu crawl theo Jobs: tải liên tục cho đến khi gom ĐỦ số jobs thỏa mãn bộ lọc nâng cao
  async function scrollAndLoadMore(pages, targetLimit = null, onProgress = null, advFilters = {}, timeout = 300000) {
    const isJobMode = targetLimit && targetLimit > 0;
    console.log(
      isJobMode
        ? `Bắt đầu tải để tìm đủ ${targetLimit} việc làm phù hợp bộ lọc nâng cao...`
        : `Bắt đầu tải ${pages} trang dữ liệu...`
    );

    const start = Date.now();
    let currentPage = 0;
    const maxPagesCap = isJobMode ? Math.max(pages * 5, 50) : pages;

    while (currentPage < maxPagesCap && Date.now() - start < timeout) {
      // Vòng lặp chờ khi người dùng bấm Tạm dừng
      while (isPaused) {
        await new Promise((resolve) => setTimeout(resolve, 300));
      }

      dismissAuthModals();

      // Kiểm tra xem đã gom đủ số job đạt chuẩn nâng cao chưa
      if (isJobMode) {
        const currentValidJobs = countMatchingJobsOnPage(advFilters);
        if (onProgress) {
          onProgress(currentValidJobs, targetLimit);
        }
        if (currentValidJobs >= targetLimit) {
          console.log(`Đã gom đủ ${currentValidJobs}/${targetLimit} việc làm thỏa mãn bộ lọc! Dừng tải thêm.`);
          break;
        }
      } else {
        if (onProgress) {
          onProgress(currentPage + 1, pages);
        }
        if (currentPage >= pages) {
          break;
        }
      }

      window.scrollTo(0, document.body.scrollHeight);
      await new Promise((resolve) => setTimeout(resolve, 1500));
      dismissAuthModals();

      // Kiểm tra lại sau khi cuộn trang
      while (isPaused) {
        await new Promise((resolve) => setTimeout(resolve, 300));
      }

      const loadMoreButton = document.querySelector('button[data-test="load-more"]');
      if (loadMoreButton && !loadMoreButton.disabled) {
        loadMoreButton.click();
        await new Promise((resolve) => setTimeout(resolve, 2000));
        dismissAuthModals();
      } else {
        console.log(`Không còn nút "Show more jobs", đã tải tối đa danh sách.`);
        break;
      }

      currentPage++;
    }

    dismissAuthModals();
    const jobCards = document.querySelectorAll(
      'li[data-test="jobListing"], div[class="JobCard_jobCardContainer__arQlW"], div[class*="jobCardContainer"]'
    );
    if (jobCards.length === 0) {
      throw new Error('Không tìm thấy việc làm nào trên trang.');
    }
    return jobCards;
  }

  // Trích xuất thông tin việc làm từ danh sách NodeList job card (kèm bộ lọc nâng cao)
  function extractJobs(jobElements, targetLimit = null, advFilters = {}) {
    const jobs = [
      ['Company Name', 'Job Title', 'Link', 'Salary', 'Location', 'Date Posted', 'Easy Apply', 'Remote', 'Company Rating', 'Job ID', 'Crawled At',],
    ];
    const seenJobIds = new Set();
    const crawlTimestamp = new Date().toISOString().replace('T', ' ').substring(0, 19);
    // Map dự phòng từ JSON nhúng (cho card không có <time> trong DOM)
    const pageAgeMap = buildJobAgeMap();
    // Đếm nguồn Date Posted để chẩn đoán N/A (xem Console khi crawl)
    let ageFromDom = 0;
    let ageFromJson = 0;
    let ageFromFilter = 0;
    let ageMissing = 0;

    jobElements.forEach((job, index) => {
      try {
        const linkElement =
          job.querySelector('a[data-test="job-link"]') ||
          job.querySelector('a[href*="/partner/jobListing.htm"]');
        let link_job = linkElement ? linkElement.getAttribute('href') || 'N/A' : 'N/A';
        if (link_job !== 'N/A' && !link_job.startsWith('http')) {
          link_job = `https://www.glassdoor.com${link_job}`;
        }

        const jobIdMatch = link_job.match(/jobListingId=(\d+)/);
        const jobId = jobIdMatch ? jobIdMatch[1] : (job.getAttribute('data-jobid') || 'N/A');
        if (jobId && jobId !== 'N/A' && seenJobIds.has(jobId)) {
          return;
        }
        if (jobId && jobId !== 'N/A') seenJobIds.add(jobId);

        let date_post = getDatePosted(job);
        if (date_post !== 'N/A') {
          ageFromDom++;
        } else if (jobId !== 'N/A' && pageAgeMap.has(jobId)) {
          date_post = pageAgeMap.get(jobId);
          ageFromJson++;
        } else {
          // Lấy nhãn thời gian từ bộ lọc ngày đăng đang áp dụng trên trang / advFilters
          const activeFilterAge =
            advFilters.advDatePosted ||
            (() => {
              try {
                return new URLSearchParams(window.location.search).get('fromAge');
              } catch (e) {
                return null;
              }
            })();
          const filterLabels = {
            '1': '≤24h',
            '3': '≤3d',
            '7': '≤7d',
            '14': '≤14d',
            '30': '≤30d',
          };
          if (activeFilterAge && filterLabels[String(activeFilterAge)]) {
            date_post = filterLabels[String(activeFilterAge)];
            ageFromFilter++;
          } else {
            date_post = 'anytime';
            ageMissing++;
          }
        }

        const company_name =
          job
            .querySelector(
              'span[class*="EmployerProfile_compactEmployerName"], [data-test="emp-name"], span[class*="employerName"]'
            )
            ?.textContent.trim() || 'N/A';

        // Trích xuất Rating công ty (VD: 4.2★)
        const ratingElement =
          job.querySelector('span[class*="rating"], [data-test="rating-value"], span[class*="ratingBox"]') ||
          Array.from(job.querySelectorAll('span, div')).find(
            (el) => el.children.length === 0 && /^\s*\d\.\d\s*★?\s*$/.test(el.textContent.trim())
          );
        const company_rating = ratingElement ? ratingElement.textContent.replace('★', '').trim() : 'N/A';

        const location =
          job
            .querySelector(
              'div[class*="JobCard_location"], [data-test="emp-location"], div[class*="location"]'
            )
            ?.textContent.trim() || 'N/A';

        const job_title =
          job
            .querySelector(
              'a[class*="JobCard_jobTitle"], a[data-test="job-link"], [data-test="job-title"]'
            )
            ?.textContent.trim() || 'N/A';

        const salary =
          job
            .querySelector(
              'div[class*="JobCard_salaryEstimate"], [data-test="detailSalary"], div[class*="salary"]'
            )
            ?.textContent.trim() || 'N/A';

        const easy_apply = job.querySelector(
          'div[class*="JobCard_easyApplyTag"], [data-test="easy-apply-tag"]'
        )
          ? 'Yes'
          : 'No';

        // Nhận diện Remote qua Location, Job Title hoặc badge trên card
        const isRemoteJob = Boolean(
          /\bremote\b/i.test(location) ||
          /\bremote\b/i.test(job_title) ||
          job.querySelector('[data-test*="remote"], span[class*="remoteWork"]')
        );
        const remote = isRemoteJob ? 'Yes' : 'No';

        if (
          [link_job, company_name, job_title, salary, location, date_post, easy_apply].every(
            (val) => val === 'N/A'
          )
        ) {
          return;
        }

        // Lọc nâng cao: chỉ lấy Easy Apply nếu được yêu cầu
        if (advFilters.advEasyApply && easy_apply !== 'Yes') {
          return;
        }

        // Lọc nâng cao: chỉ lấy Remote nếu được yêu cầu
        if (advFilters.advRemote && remote !== 'Yes') {
          return;
        }

        // Lọc nâng cao: chỉ lấy việc có hiển thị mức lương
        if (advFilters.advHasSalary && salary === 'N/A') {
          return;
        }

        // Lọc nâng cao: loại trừ từ khóa trong tiêu đề
        if (advFilters.advExcludeKeywords && advFilters.advExcludeKeywords.trim()) {
          const excludeList = advFilters.advExcludeKeywords
            .split(',')
            .map((k) => k.trim().toLowerCase())
            .filter(Boolean);
          const hasExcluded = excludeList.some((k) => job_title.toLowerCase().includes(k));
          if (hasExcluded) return;
        }

        // Lọc nâng cao: Đánh giá tối thiểu
        if (advFilters.advRating && company_rating !== 'N/A') {
          const minRating = parseFloat(advFilters.advRating);
          const currRating = parseFloat(company_rating);
          if (!isNaN(minRating) && !isNaN(currRating) && currRating < minRating) {
            return;
          }
        }

        jobs.push([company_name, job_title, link_job, salary, location, date_post, easy_apply, remote, company_rating, jobId, crawlTimestamp,]);
      } catch (e) {
        console.error(`Lỗi trích xuất việc làm thứ ${index + 1}: ${e.message}`);
      }
    });

    console.log(
      `[crawler] Date Posted: DOM=${ageFromDom}, JSON=${ageFromJson}, Filter=${ageFromFilter}, anytime=${ageMissing} (pageAgeMap=${pageAgeMap.size})`
    );

    if (targetLimit && jobs.length - 1 > targetLimit) {
      return [jobs[0], ...jobs.slice(1, targetLimit + 1)];
    }
    return jobs;
  }

  // Tạo URL tìm kiếm tự động kèm toàn bộ tham số bộ lọc nâng cao
  function buildSearchUrl(jobVal, locationVal, advFilters = {}) {
    const url = new URL('https://www.glassdoor.com/Job/jobs.htm');
    if (jobVal) url.searchParams.set('sc.keyword', jobVal);
    if (locationVal) url.searchParams.set('locKeyword', locationVal);

    if (advFilters.advEasyApply) url.searchParams.set('applicationType', '1');
    if (advFilters.advRemote) url.searchParams.set('remoteWorkType', '1');
    if (advFilters.advDatePosted) url.searchParams.set('fromAge', advFilters.advDatePosted);
    if (advFilters.advRating) url.searchParams.set('minRating', advFilters.advRating);
    if (advFilters.advMinSalary) {
      const minSal = parseInt(advFilters.advMinSalary, 10);
      if (!isNaN(minSal) && minSal > 0) {
        url.searchParams.set('minSalary', (minSal * 1000).toString());
      }
    }
    return url.toString();
  }

  // Thu thập jobListingId từ danh sách card (phục vụ ước lượng tuổi bằng filter)
  function collectJobIds(jobElements) {
    const ids = [];
    const seen = new Set();
    (jobElements || []).forEach((job) => {
      try {
        const a =
          job.querySelector('a[data-test="job-link"]') ||
          job.querySelector('a[href*="/partner/jobListing.htm"]');
        const href = a ? a.getAttribute('href') || '' : '';
        const m = href.match(/jobListingId=(\d+)/);
        const id = m ? m[1] : (job.getAttribute && job.getAttribute('data-jobid')) || null;
        if (id && !seen.has(id)) {
          seen.add(id);
          ids.push(id);
        }
      } catch (e) {}
    });
    return ids;
  }



  // Tải danh sách jobs về dưới dạng file CSV
  function downloadCsv(jobs) {
    if (!jobs || jobs.length <= 1) {
      throw new Error('Không có dữ liệu việc làm hợp lệ để tải xuống.');
    }
    const validJobCount = jobs.length - 1;
    let fileTitle = document.title.replace(/^\d+(?:_\d+)*_/, '');
    fileTitle = fileTitle.replace(/[\/\\:\*\?"<>\|]/g, '_');
    fileTitle = encodeURIComponent(fileTitle).replace(/%[0-9A-F]{2}/gi, '_');

    const csvContent = jobs
      .map((row) =>
        row
          .map((cell) => {
            const safe = String(cell ?? '').replace(/\r?\n+/g, ' ');
            if (typeof cell === 'string' && (cell.startsWith('https://') || cell.startsWith('http://'))) {
              return safe;
            }
            return `"${safe.replace(/"/g, '""')}"`;
          })
          .join(',')
      )
      .join('\n');

    const dataStr = 'data:text/csv;charset=utf-8,' + encodeURIComponent(csvContent);
    const downloadAnchor = document.createElement('a');
    downloadAnchor.setAttribute('href', dataStr);
    downloadAnchor.setAttribute('download', `${validJobCount}_${fileTitle}.csv`);
    document.body.appendChild(downloadAnchor);
    downloadAnchor.click();
    downloadAnchor.remove();
    return validJobCount;
  }

  // Hiển thị tooltip chỉ vị trí trực tiếp trên ô tìm kiếm
  function showInputTooltip(inputEl, message, isInfo = false) {
    document.querySelectorAll('.crawler-input-tooltip').forEach((el) => el.remove());
    document
      .querySelectorAll('.crawler-highlight-input')
      .forEach((el) => el.classList.remove('crawler-highlight-input'));

    const tooltip = document.createElement('div');
    tooltip.className = `crawler-input-tooltip ${isInfo ? 'info' : ''}`;
    tooltip.innerHTML = message;
    document.body.appendChild(tooltip);

    if (inputEl) {
      const updatePosition = () => {
        const rect = inputEl.getBoundingClientRect();
        tooltip.style.top = `${rect.top + window.scrollY - 46}px`;
        tooltip.style.left = `${rect.left + window.scrollX + 10}px`;
      };
      updatePosition();

      inputEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
      if (!isInfo) {
        inputEl.classList.add('crawler-highlight-input');
        inputEl.focus();
      }

      const cleanup = () => {
        inputEl.classList.remove('crawler-highlight-input');
        tooltip.remove();
      };

      inputEl.addEventListener('input', cleanup, { once: true });
      window.addEventListener('resize', updatePosition, { once: true });
    }

    setTimeout(() => {
      tooltip.remove();
      if (inputEl) inputEl.classList.remove('crawler-highlight-input');
    }, 5000);
  }

  return {
    startCrawlingSession,
    stopCrawlingSession,
    pauseCrawling,
    resumeCrawling,
    getIsPaused,
    getDatePosted,
    isDatePostedText,
    buildJobAgeMap,
    collectJobIds,
    scrollAndLoadMore,
    extractJobs,
    buildSearchUrl,
    downloadCsv,
    showInputTooltip,
  };
})();
