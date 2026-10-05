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

  // Cuộn trang và bấm nút tải thêm ("Show more jobs")
  async function scrollAndLoadMore(pages, targetLimit = null, onProgress = null, timeout = 180000) {
    console.log(`Bắt đầu tải ${pages} trang dữ liệu...`);
    const start = Date.now();
    let currentPage = 0;

    if (onProgress) onProgress(1, pages);

    while (currentPage < pages && Date.now() - start < timeout) {
      // Vòng lặp chờ khi người dùng bấm Tạm dừng
      while (isPaused) {
        await new Promise((resolve) => setTimeout(resolve, 300));
      }

      dismissAuthModals();
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
      if (onProgress && currentPage < pages) {
        onProgress(currentPage + 1, pages);
      }
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

  // Trích xuất thông tin việc làm từ danh sách NodeList job card
  function extractJobs(jobElements, targetLimit = null) {
    const jobs = [
      ['Company Name', 'Job Title', 'Link', 'Salary', 'Location', 'Date Posted', 'Easy Apply'],
    ];
    const seenJobIds = new Set();

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
        const jobId = jobIdMatch ? jobIdMatch[1] : null;
        if (jobId && seenJobIds.has(jobId)) {
          return;
        }
        if (jobId) seenJobIds.add(jobId);

        const date_post =
          job
            .querySelector('div[class*="JobCard_listingAge"], div[class*="listingAge"]')
            ?.textContent.trim() ||
          Array.from(job.querySelectorAll('span, div'))
            .find(
              (el) =>
                el.children.length === 0 &&
                /^\s*(\d+[dhwm]|Just posted|Today)\s*$/i.test(el.textContent)
            )
            ?.textContent.trim() ||
          'N/A';

        const company_name =
          job
            .querySelector(
              'span[class*="EmployerProfile_compactEmployerName"], [data-test="emp-name"], span[class*="employerName"]'
            )
            ?.textContent.trim() || 'N/A';

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

        if (
          [link_job, company_name, job_title, salary, location, date_post, easy_apply].every(
            (val) => val === 'N/A'
          )
        ) {
          return;
        }

        jobs.push([company_name, job_title, link_job, salary, location, date_post, easy_apply]);
      } catch (e) {
        console.error(`Lỗi trích xuất việc làm thứ ${index + 1}: ${e.message}`);
      }
    });

    if (targetLimit && jobs.length - 1 > targetLimit) {
      return [jobs[0], ...jobs.slice(1, targetLimit + 1)];
    }
    return jobs;
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
            if (typeof cell === 'string' && (cell.startsWith('https://') || cell.startsWith('http://'))) {
              return cell;
            }
            return `"${cell.replace(/"/g, '""')}"`;
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
    scrollAndLoadMore,
    extractJobs,
    downloadCsv,
    showInputTooltip,
  };
})();
