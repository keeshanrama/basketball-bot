import { firefox } from 'playwright';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

dotenv.config({ path: join(__dirname, '..', '.env') });

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June',
                     'July', 'August', 'September', 'October', 'November', 'December'];

class CourtReserveBooker {
  constructor() {
    this.browser = null;
    this.context = null;
    this.page = null;
    this.portalBase = 'https://app.courtreserve.com/Online/Portal/Index/6765';
  }

  async initialize() {
    console.log('🌐 Launching browser...');
    
    this.browser = await firefox.launch({
      headless: false,
      slowMo: 100
    });

    this.context = await this.browser.newContext({
      viewport: { width: 1280, height: 720 },
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36'
    });

    this.page = await this.context.newPage();
    await this.login();
  }

  async login() {
    console.log('🔐 Logging in to CourtReserve...');

    console.log('DEBUG - Username from env:', process.env.COURTRESERVE_USERNAME);
    console.log('DEBUG - Password from env:', process.env.COURTRESERVE_PASSWORD ? '(set)' : '(NOT SET)');
    console.log('DEBUG - Portal URL:', process.env.COURTRESERVE_PORTAL_URL);
    
    try {
      await this.page.goto(process.env.COURTRESERVE_PORTAL_URL, {
        waitUntil: 'networkidle',
        timeout: 30000
      });

      console.log('📸 Landing page loaded, looking for LOG IN button...');
      await this.page.click('button:has-text("LOG IN"), a:has-text("LOG IN")');
      console.log('✅ Clicked LOG IN button');
      await this.page.waitForTimeout(2000);
      await this.page.screenshot({ path: 'login-form.png' });

      await this.page.waitForSelector('input[placeholder*="Email"], input[placeholder*="email"]', {
        timeout: 10000
      });

      console.log('📝 Filling in email...');
      await this.page.fill('input[placeholder*="Email"], input[placeholder*="email"]', process.env.COURTRESERVE_USERNAME);

      console.log('📝 Filling in password...');
      await this.page.fill('input[placeholder*="Password"], input[placeholder*="password"]', process.env.COURTRESERVE_PASSWORD);

      await this.page.waitForTimeout(1000);

      console.log('🔘 Clicking Continue button...');
      await this.page.click('button:has-text("Continue")');
      await this.page.waitForLoadState('networkidle', { timeout: 15000 });

      console.log('✅ Successfully logged in');
      await this.page.screenshot({ path: 'login-success.png' });
      
    } catch (error) {
      console.error('❌ Login failed:', error.message);
      await this.page.screenshot({ path: 'login-error.png' });
      throw error;
    }
  }

  // ───────────────────────────────────────────────────────────
  //  NAVIGATION: go straight to the booking scheduler for a date
  // ───────────────────────────────────────────────────────────

  /**
   * Navigate to the booking page and land on the correct date.
   * Goes through the portal menu to reach "Book a Full Court",
   * then navigates the scheduler's day-view to the target date.
   */
  async _navigateToBookingPage(gameDate) {
    console.log('🏠 Going to portal home...');
    await this.page.goto(this.portalBase, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await this.page.waitForTimeout(2000);

    console.log('🔵 Clicking menu button...');
    await this.page.click('a[href="#menu"]');
    await this.page.waitForTimeout(1000);

    console.log('🏀 Clicking "Book Basketball"...');
    await this.page.click('a:has-text("Book Basketball"), button:has-text("Book Basketball")');
    await this.page.waitForTimeout(1000);

    console.log('📋 Clicking "Book a Full Court"...');
    await this.page.click('a:has-text("Book a Full Court")');
    await this.page.waitForTimeout(2000);
    await this.page.screenshot({ path: 'step-scheduler-loaded.png' });

    // Navigate the scheduler to the target date
    await this._navigateSchedulerToDate(gameDate);
    await this.page.screenshot({ path: 'step-date-selected.png' });
  }

  /**
   * Navigate the Kendo scheduler's day-view to the target date.
   * Uses smart direction detection (forward vs backward) to minimize clicks.
   */
  async _navigateSchedulerToDate(gameDate) {
    const targetDay = gameDate.getDate();
    const targetMonthName = MONTH_NAMES[gameDate.getMonth()];
    const targetYear = gameDate.getFullYear();

    console.log(`📅 Navigating scheduler to ${targetMonthName} ${targetDay}, ${targetYear}...`);

    const targetPatterns = this._buildDatePatterns(gameDate);

    for (let attempts = 0; attempts < 90; attempts++) {
      const currentDateText = await this._getSchedulerDateText();
      console.log(`📅 Scheduler showing: "${currentDateText}"`);

      if (this._dateTextMatches(currentDateText, targetPatterns)) {
        console.log(`✅ Scheduler is on correct date!`);
        return;
      }

      // Determine direction: compare parsed current date vs target
      const currentDate = this._parseDateFromToolbar(currentDateText);
      const direction = (!currentDate || currentDate < gameDate) ? 'next' : 'prev';

      try {
        if (direction === 'next') {
          await this.page.click(
            '.k-scheduler-toolbar .k-nav-next, [data-testid="link-2"], button[aria-label="Next"]'
          );
        } else {
          await this.page.click(
            '.k-scheduler-toolbar .k-nav-prev, [data-testid="link-1"], button[aria-label="Previous"]'
          );
        }
        await this.page.waitForTimeout(400);
      } catch (e) {
        console.log(`⚠️ Could not click ${direction}:`, e.message);
        break;
      }
    }

    console.log('⚠️ Could not confirm scheduler is on correct date after max attempts');
  }

  /** Read the current date text from the scheduler toolbar */
  async _getSchedulerDateText() {
    return this.page.$eval(
      '.k-scheduler-toolbar .k-nav-current, [data-testid="link-0"], .fn-scheduler-toolbar-name',
      el => el.textContent.trim()
    ).catch(() => '');
  }

  /** Build an array of substrings that would confirm we're on the right date */
  _buildDatePatterns(gameDate) {
    const day = gameDate.getDate();
    const monthName = MONTH_NAMES[gameDate.getMonth()];
    const monthShort = monthName.substring(0, 3);
    const year = gameDate.getFullYear();

    return [
      `${monthName} ${day}, ${year}`,   // "March 6, 2026"
      `${monthName} ${day} ${year}`,     // "March 6 2026"
      `${monthShort} ${day}, ${year}`,   // "Mar 6, 2026"
      // For schedulers that don't show year, match "March 6," or "Mar 6,"
      `${monthName} ${day},`,
      `${monthShort} ${day},`,
    ];
  }

  /** Check if the toolbar text matches any of our expected patterns */
  _dateTextMatches(text, patterns) {
    return patterns.some(p => text.includes(p));
  }

  /** Try to extract a Date from toolbar text like "Monday, February 17, 2026" */
  _parseDateFromToolbar(text) {
    try {
      const m = text.match(/(\w+)\s+(\d{1,2}),?\s+(\d{4})/);
      if (m) {
        const monthIdx = MONTH_NAMES.findIndex(n => n.startsWith(m[1].substring(0, 3)));
        if (monthIdx >= 0) {
          return new Date(parseInt(m[3]), monthIdx, parseInt(m[2]));
        }
      }
    } catch (e) {}
    return null;
  }

  // ───────────────────────────────────────────────────────────
  //  TIME SLOT DISCOVERY & MATCHING
  // ───────────────────────────────────────────────────────────

  /**
   * Build all the time-string variants we need to match against the DOM.
   * Centralizes ALL time formatting so booking and availability use the same logic.
   */
  _buildTimeMatchData(timeRange) {
    const startHour24 = parseInt(timeRange.startTime.split(':')[0]);
    const startMin = timeRange.startTime.split(':')[1] || '00';
    // Convert 24h → 12h correctly for all edge cases (0, 12, 13-23)
    const displayHour = startHour24 === 0  ? 12
                      : startHour24 > 12   ? startHour24 - 12
                      : startHour24;
    const amPm = startHour24 >= 12 ? 'PM' : 'AM';

    // Human-readable label: "9:00 PM"
    const timeLabel = `${displayHour}:${startMin} ${amPm}`;

    // URL-encoded patterns for data-href matching:
    //   CourtReserve encodes times in URLs like "...2026%209:00%20PM..."
    //   The %20 before the hour prevents "1:00" from matching inside "11:00"
    const urlDisplayPattern = new RegExp(
      `%20${displayHour}:${startMin}%20${amPm}`, 'i'
    );
    // 24h variant: "%2021:00"
    const url24hPattern = new RegExp(
      `%20${startHour24}:${startMin}(?:%20|&|$)`, 'i'
    );

    // For aria-label / visible text: ensure "1:00 PM" doesn't match "11:00 PM"
    // by requiring a non-digit (or start-of-string) before the hour.
    //
    // CRITICAL: Also must NOT match the END time in range strings like
    // "at 9:00 PM to 10:00 PM". The word "to" before a time means it's
    // an end-time, not a start-time. We use a negative lookbehind for "to ".
    const strictStartTimeRegex = new RegExp(
      `(?:^|[^\\d])(?<!to\\s)${displayHour}:${startMin}\\s*${amPm}`, 'i'
    );

    // For the dataTime field which contains JUST the start time like "10:00 PM"
    // we can use an exact match
    const exactTimeRegex = new RegExp(
      `^\\s*${displayHour}:${startMin}\\s*${amPm}\\s*$`, 'i'
    );

    return {
      startHour24,
      displayHour,
      amPm,
      startMin,
      timeLabel,
      urlDisplayPattern,
      url24hPattern,
      strictStartTimeRegex,
      exactTimeRegex,
    };
  }

  /**
   * Scroll the scheduler so the target time slot row is visible.
   * Uses proportional scrolling based on hour position instead of blind scrolling.
   * Also scrolls BOTH the internal Kendo scheduler container AND the time labels sidebar.
   */
  async _scrollToTargetTime(startHour24) {
    console.log(`📜 Scrolling to bring ${startHour24}:00 into view...`);

    // Step 1: Scroll the Kendo scheduler's internal scrollable content area
    await this.page.evaluate((targetHour) => {
      // The scheduler has TWO scrollable areas that need to stay in sync:
      // 1. The content area (where the slots/buttons are)
      // 2. The times sidebar (where "5:00 AM", "6:00 AM" etc are shown)
      const contentArea = document.querySelector(
        '.k-scheduler-content, [class*="scheduler-content"]'
      );
      const timesArea = document.querySelector(
        '.k-scheduler-times .k-scheduler-table'
      )?.parentElement;

      if (contentArea) {
        const totalHeight = contentArea.scrollHeight;
        const rowHeight = totalHeight / 24;
        const targetScroll = Math.max(0, (targetHour - 1) * rowHeight);
        contentArea.scrollTop = targetScroll;
        
        // Also sync the times sidebar if it's a separate scroll container
        if (timesArea && timesArea !== contentArea) {
          timesArea.scrollTop = targetScroll;
        }
      }
    }, startHour24);

    await this.page.waitForTimeout(800);

    // Step 2: Find the actual time label element and use scrollIntoView
    // This is more reliable than proportional math since it targets the exact element
    const scrolledToLabel = await this.page.evaluate((targetHour) => {
      const hour12 = targetHour === 0 ? 12 : targetHour > 12 ? targetHour - 12 : targetHour;
      const amPm = targetHour >= 12 ? 'PM' : 'AM';
      const targetText = `${hour12}:00 ${amPm}`;
      
      // Search all text in the scheduler times column
      const allCells = document.querySelectorAll(
        '.k-scheduler-times td, .k-scheduler-times th, ' +
        '.k-scheduler-table td, [class*="scheduler"] td'
      );
      for (const cell of allCells) {
        const text = cell.textContent.trim();
        if (text === targetText || text === `${hour12}:00`) {
          cell.scrollIntoView({ block: 'center', behavior: 'instant' });
          return text;
        }
      }

      // Fallback: look for the time in any element on the page
      const allElements = document.querySelectorAll('td, th, div, span');
      for (const el of allElements) {
        if (el.children.length === 0 && el.textContent.trim() === targetText) {
          el.scrollIntoView({ block: 'center', behavior: 'instant' });
          return el.textContent.trim();
        }
      }

      return null;
    }, startHour24);

    if (scrolledToLabel) {
      console.log(`📜 Scrolled to time label: "${scrolledToLabel}"`);
    } else {
      console.log(`⚠️ Could not find time label for ${startHour24}:00, using proportional scroll`);
    }

    await this.page.waitForTimeout(500);
  }

  /**
   * Gather all slot button data from the page in one pass.
   * Captures every useful attribute since CourtReserve's DOM varies.
   */
  async _getAllSlotButtons() {
    return this.page.evaluate(() => {
      const results = [];
      // Broad selector: find all clickable elements that look like reserve buttons
      const buttons = document.querySelectorAll(
        'a.slot-btn, a.btn-consolidate-slot, [class*="slot-btn"], ' +
        'a[data-href*="Reservation"], a[href*="Reservation"], ' +
        'a.reserve-btn, button.reserve-btn, ' +
        '[class*="reserve"], [class*="Reserve"]'
      );
      buttons.forEach((btn, index) => {
        // Collect ALL attributes for debugging
        const attrs = {};
        for (const attr of btn.attributes) {
          attrs[attr.name] = attr.value.substring(0, 200);
        }
        
        // Walk up to find the parent time-slot container's attributes
        const parentSlot = btn.closest('[data-time], [aria-label], [class*="slot"]');
        const parentAriaLabel = parentSlot?.getAttribute('aria-label') || '';
        const parentDataTime = parentSlot?.getAttribute('data-time') || '';
        const parentDataHref = parentSlot?.getAttribute('data-href') || '';

        results.push({
          index,
          ariaLabel: btn.getAttribute('aria-label') || '',
          dataHref: btn.getAttribute('data-href') || '',
          href: btn.getAttribute('href') || '',
          onclick: btn.getAttribute('onclick') || '',
          text: btn.textContent.trim().substring(0, 100),
          className: btn.className,
          tagName: btn.tagName,
          // Parent container info
          parentAriaLabel,
          parentDataTime,
          parentDataHref,
          // All attributes for debugging
          allAttrs: JSON.stringify(attrs).substring(0, 500),
        });
      });
      return results;
    });
  }

  /**
   * Gather all "none available" indicator data from the page in one pass.
   */
  async _getAllUnavailableSlots() {
    return this.page.evaluate(() => {
      const results = [];
      const slots = document.querySelectorAll(
        '.not-available-courts-container, [data-testid="noneAvailableBtn"], [class*="not-available"]'
      );
      slots.forEach(slot => {
        results.push({
          dataTime: slot.getAttribute('data-time') || '',
          parentAriaLabel: slot.closest('[aria-label]')?.getAttribute('aria-label') || '',
          parentDataTime: slot.closest('[data-time]')?.getAttribute('data-time') || '',
          text: slot.textContent.trim().substring(0, 100),
        });
      });
      return results;
    });
  }

  /**
   * Check if a slot button matches our target time.
   * Single source of truth for time matching — used by both book and check.
   */
  _slotMatchesTime(slotData, matchData) {
    const { ariaLabel, dataHref, href, parentAriaLabel, parentDataTime, parentDataHref, text, onclick } = slotData;
    const { strictStartTimeRegex, exactTimeRegex, urlDisplayPattern, url24hPattern, timeLabel } = matchData;

    // Check URLs (data-href, href, parent data-href, onclick)
    for (const urlToCheck of [dataHref, href, parentDataHref, onclick]) {
      if (!urlToCheck) continue;
      if (urlDisplayPattern.test(urlToCheck)) return true;
      if (url24hPattern.test(urlToCheck)) return true;
    }

    // Check aria-labels (own + parent) with start-time-only regex
    for (const label of [ariaLabel, parentAriaLabel]) {
      if (!label) continue;
      if (strictStartTimeRegex.test(label)) return true;
    }

    // Check the dataTime field on parent (exact match, e.g. "10:00 PM")
    if (parentDataTime && exactTimeRegex.test(parentDataTime)) return true;

    // Check visible text content (e.g. button says "Reserve" inside a 10:00 PM row)
    // Only useful if the text itself contains the time
    if (text && strictStartTimeRegex.test(text)) return true;

    return false;
  }

  /**
   * Check if an unavailable slot indicator matches our target time.
   * 
   * CRITICAL: The parentAriaLabel often contains a RANGE like
   * "null on Friday, March 6, 2026 at 9:00 PM to 10:00 PM"
   * We must match only the START time (after "at"), not the END time (after "to").
   * 
   * The dataTime field contains just the start time like "9:00 PM" — use exact match.
   */
  _unavailableMatchesTime(unavailData, matchData) {
    const { dataTime, parentAriaLabel, parentDataTime } = unavailData;
    const { strictStartTimeRegex, exactTimeRegex, urlDisplayPattern, url24hPattern } = matchData;

    // dataTime is the most reliable — it's just the start time, e.g. "9:00 PM"
    if (dataTime && exactTimeRegex.test(dataTime)) return true;

    // parentDataTime is also typically just the start time
    if (parentDataTime && exactTimeRegex.test(parentDataTime)) return true;

    // parentAriaLabel contains a range — use the start-time-only regex
    // which has a negative lookbehind for "to " to avoid matching end times
    if (parentAriaLabel && strictStartTimeRegex.test(parentAriaLabel)) return true;

    // URL-encoded checks on all fields
    for (const field of [dataTime, parentAriaLabel, parentDataTime]) {
      if (!field) continue;
      if (urlDisplayPattern.test(field)) return true;
      if (url24hPattern.test(field)) return true;
    }

    return false;
  }

  // ───────────────────────────────────────────────────────────
  //  MAIN BOOKING FLOW
  // ───────────────────────────────────────────────────────────

  async bookCourt(gameDate, timeRange, courtName) {
    console.log(`📅 Booking court for ${gameDate.toLocaleDateString()} at ${timeRange.startDisplay}-${timeRange.endDisplay}`);
    
    try {
      // Step 1-4: Navigate to booking page on the correct date
      await this._navigateToBookingPage(gameDate);
      console.log('📸 Booking page loaded and date selected');

      // Build centralized time matching data
      const matchData = this._buildTimeMatchData(timeRange);
      console.log(`🔍 Looking for time slot: ${matchData.timeLabel} (${matchData.startHour24}:00 in 24h)`);

      // Step 5: Scroll to bring the target time into view
      await this._scrollToTargetTime(matchData.startHour24);
      await this.page.screenshot({ path: 'step-scrolled.png' });

      // Step 6: Gather all slot data for debugging and matching
      const allSlots = await this._getAllSlotButtons();
      console.log(`📊 Found ${allSlots.length} reserve buttons on page`);
      for (const s of allSlots.slice(0, 20)) {
        console.log(`  slot #${s.index}: text="${s.text}" parentTime="${s.parentDataTime}" parentAria="${s.parentAriaLabel.substring(0, 80)}"`);
        if (!s.ariaLabel && !s.dataHref && !s.href && !s.parentAriaLabel) {
          console.log(`    allAttrs: ${s.allAttrs}`);
        }
      }

      // Step 7: Check if slot is unavailable
      const unavailableSlots = await this._getAllUnavailableSlots();
      console.log(`📊 Found ${unavailableSlots.length} unavailable indicators`);

      if (unavailableSlots.some(s => this._unavailableMatchesTime(s, matchData))) {
        console.log(`❌ Time slot ${matchData.timeLabel} is already fully booked`);
        await this.page.screenshot({ path: 'slot-already-booked.png' });
        return {
          success: false,
          alreadyBooked: true,
          message: `The ${matchData.timeLabel} slot is already fully booked`,
          screenshots: { failure: 'slot-already-booked.png' }
        };
      }

      // Step 8: Find the matching reserve button
      let targetSlotIndex = -1;
      for (const slot of allSlots) {
        if (this._slotMatchesTime(slot, matchData)) {
          targetSlotIndex = slot.index;
          console.log(`✅ Matched slot #${slot.index}: aria="${slot.ariaLabel.substring(0, 70)}"`);
          break;
        }
      }

      if (targetSlotIndex === -1) {
        console.log(`❌ Could not find time slot: ${matchData.timeLabel}`);
        console.log('🔍 All available slots (full dump):');
        for (const s of allSlots) {
          console.log(`  - text="${s.text}" parentTime="${s.parentDataTime}" parentAria="${s.parentAriaLabel.substring(0, 100)}" attrs=${s.allAttrs}`);
        }
        await this.page.screenshot({ path: 'time-slot-not-found.png', fullPage: true });
        return {
          success: false,
          message: `Could not find time slot: ${matchData.timeLabel}`,
          screenshots: { failure: 'time-slot-not-found.png' }
        };
      }

      // Step 9: Click the matched button (by index to avoid stale element handles)
      const SLOT_SELECTOR = 'a.slot-btn, a.btn-consolidate-slot, [class*="slot-btn"], ' +
        'a[data-href*="Reservation"], a[href*="Reservation"], ' +
        'a.reserve-btn, button.reserve-btn, ' +
        '[class*="reserve"], [class*="Reserve"]';

      await this.page.evaluate(({idx, sel}) => {
        const buttons = document.querySelectorAll(sel);
        if (buttons[idx]) buttons[idx].scrollIntoView({ block: 'center' });
      }, {idx: targetSlotIndex, sel: SLOT_SELECTOR});
      await this.page.waitForTimeout(500);

      await this.page.evaluate(({idx, sel}) => {
        const buttons = document.querySelectorAll(sel);
        if (buttons[idx]) buttons[idx].click();
      }, {idx: targetSlotIndex, sel: SLOT_SELECTOR});

      console.log('📸 Time slot clicked');
      await this.page.waitForTimeout(2000);
      await this.page.screenshot({ path: 'step-timeslot-clicked.png' });

      // Step 10: Handle confirmation popup
      console.log('🎯 Waiting for confirmation popup...');
      const confirmed = await this._handleConfirmation();
      await this.page.screenshot({ path: 'step-confirmation.png', fullPage: true });

      // Step 11: Navigate back to verify the booking on the calendar
      await this._navigateToBookingPage(gameDate);
      await this._scrollToTargetTime(matchData.startHour24);
      await this.page.screenshot({ path: 'step-booked-calendar.png', fullPage: true });

      if (confirmed) {
        console.log('✅ Booking completed successfully!');
        return { 
          success: true, 
          screenshots: {
            confirmation: 'step-confirmation.png',
            calendar: 'step-booked-calendar.png'
          }
        };
      } else {
        console.log('⚠️ Could not find confirmation button - check screenshots');
        return { 
          success: false, 
          message: 'Could not find confirmation button',
          screenshots: {
            confirmation: 'step-confirmation.png',
            calendar: 'step-booked-calendar.png'
          }
        };
      }

    } catch (error) {
      console.error('❌ Booking failed:', error.message);
      try { await this.page.screenshot({ path: 'booking-error.png' }); } catch (e) {}
      return { 
        success: false, 
        error: error.message,
        screenshots: { failure: 'booking-error.png' }
      };
    }
  }

  /**
   * Try to click the confirmation/submit button in a modal.
   */
  async _handleConfirmation() {
    await this.page.waitForTimeout(2000);

    const confirmSelectors = [
      'button:has-text("Confirm")',
      'button:has-text("Complete Reservation")',
      'button:has-text("Submit")',
      '.modal button:has-text("Book")',
      '.modal button[type="submit"]',
      'button:has-text("Reserve")',
      '.modal .btn-primary, .modal .btn-success',
      '[class*="modal"] button.btn-primary',
    ];

    for (const selector of confirmSelectors) {
      try {
        const element = await this.page.$(selector);
        if (element && await element.isVisible()) {
          console.log(`✅ Found confirmation button: ${selector}`);
          await element.click();
          await this.page.waitForTimeout(2000);
          return true;
        }
      } catch (e) {}
    }

    // Last resort: scan any open modal for a confirm-like button
    try {
      const clicked = await this.page.evaluate(() => {
        const modal = document.querySelector(
          '.modal.show, .modal.in, [class*="modal"][style*="display: block"]'
        );
        if (!modal) return false;
        const buttons = modal.querySelectorAll('button, a.btn');
        for (const btn of buttons) {
          const text = btn.textContent.trim().toLowerCase();
          if (['confirm', 'submit', 'book', 'reserve', 'complete', 'ok', 'yes'].some(w => text.includes(w))) {
            btn.click();
            return true;
          }
        }
        return false;
      });
      if (clicked) {
        console.log('✅ Confirmed via modal button scan');
        await this.page.waitForTimeout(2000);
        return true;
      }
    } catch (e) {}

    return false;
  }

  // ───────────────────────────────────────────────────────────
  //  AVAILABILITY CHECK
  // ───────────────────────────────────────────────────────────

  async checkAvailability(gameDate, timeRange) {
    console.log(`🔍 Checking availability for ${gameDate.toLocaleDateString()} at ${timeRange.startDisplay}`);

    try {
      await this._navigateToBookingPage(gameDate);

      const matchData = this._buildTimeMatchData(timeRange);
      console.log(`🔍 Checking slot: ${matchData.timeLabel}`);

      await this._scrollToTargetTime(matchData.startHour24);
      await this.page.waitForTimeout(1000);

      // Gather all data in one pass
      const allSlots = await this._getAllSlotButtons();
      const unavailableSlots = await this._getAllUnavailableSlots();

      console.log(`📊 Reserve buttons: ${allSlots.length}, Unavailable: ${unavailableSlots.length}`);
      for (const s of allSlots.slice(0, 15)) {
        console.log(`  slot #${s.index}: text="${s.text}" parentTime="${s.parentDataTime}" parentAria="${s.parentAriaLabel.substring(0, 80)}"`);
        if (!s.ariaLabel && !s.dataHref && !s.href && !s.parentAriaLabel) {
          console.log(`    allAttrs: ${s.allAttrs}`);
        }
      }
      for (const s of unavailableSlots.slice(0, 15)) {
        console.log(`  unavail: dataTime="${s.dataTime}" | parentAria="${s.parentAriaLabel.substring(0, 80)}"`);
      }

      // Check unavailable first
      if (unavailableSlots.some(s => this._unavailableMatchesTime(s, matchData))) {
        await this._scrollToTargetTime(matchData.startHour24);
        await this.page.screenshot({ path: 'availability-check.png' });
        console.log(`❌ Slot ${matchData.timeLabel} is unavailable`);
        return { status: 'unavailable', timeLabel: matchData.timeLabel, screenshot: 'availability-check.png' };
      }

      // Check available
      if (allSlots.some(s => this._slotMatchesTime(s, matchData))) {
        await this._scrollToTargetTime(matchData.startHour24);
        await this.page.screenshot({ path: 'availability-check.png' });
        console.log(`✅ Slot ${matchData.timeLabel} is available`);
        return { status: 'available', timeLabel: matchData.timeLabel, screenshot: 'availability-check.png' };
      }

      await this._scrollToTargetTime(matchData.startHour24);
      await this.page.screenshot({ path: 'availability-check.png' });
      console.log(`⚠️ Slot ${matchData.timeLabel} status unknown`);
      return { status: 'unknown', timeLabel: matchData.timeLabel, screenshot: 'availability-check.png' };

    } catch (error) {
      console.error('❌ Availability check failed:', error.message);
      try { await this.page.screenshot({ path: 'availability-check-error.png' }); } catch (e) {}
      return {
        status: 'error',
        error: error.message,
        screenshot: 'availability-check-error.png'
      };
    }
  }

  async screenshot(filename) {
    if (this.page) {
      await this.page.screenshot({ path: filename });
    }
  }

  async close() {
    if (this.browser) {
      await this.browser.close();
      console.log('🔒 Browser closed');
    }
  }
}

export default CourtReserveBooker;