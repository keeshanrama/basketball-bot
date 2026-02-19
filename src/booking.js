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
  }

  async initialize() {
    console.log('🌐 Launching browser...');
    
    const isHeadless = process.env.HEADLESS !== 'false'; // default true (Railway), set HEADLESS=false for local
    console.log(`🖥️  Browser headless mode: ${isHeadless}`);
    
    this.browser = await firefox.launch({
      headless: isHeadless,
      slowMo: isHeadless ? 50 : 100,
      args: isHeadless ? ['--no-sandbox', '--disable-setuid-sandbox'] : []
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

  /**
   * Shared helper: open the calendar picker and navigate to the correct month/year
   */
  async _openAndNavigateCalendar(gameDate) {
    const targetMonth = gameDate.getMonth();
    const targetYear = gameDate.getFullYear();
    const targetMonthName = MONTH_NAMES[targetMonth];
    const targetDay = gameDate.getDate();
  
    console.log(`📅 Navigating scheduler to ${targetMonthName} ${targetDay}, ${targetYear}...`);
  
    // The scheduler shows one day at a time - use forward arrow to navigate day by day
    // Read current date from the toolbar
    for (let attempts = 0; attempts < 60; attempts++) {
      const currentDateText = await this.page.$eval(
        '.k-scheduler-toolbar .k-nav-current, [data-testid="link-0"], .fn-scheduler-toolbar-name',
        el => el.textContent.trim()
      ).catch(() => '');
  
      console.log(`📅 Scheduler showing: "${currentDateText}"`);
  
      // Check if we're on the right date
      // Text format is like "Monday, February 16, 2026" or "Mon, Feb 16"
      const targetDateStr = gameDate.toLocaleDateString('en-US', { 
        month: 'long', day: 'numeric', year: 'numeric' 
      }); // "March 6, 2026"
      const targetDateShort = `${targetMonthName.substring(0,3)} ${targetDay}`; // "Mar 6"
  
      if (
        currentDateText.includes(targetDateStr) ||
        currentDateText.includes(`${targetMonthName} ${targetDay}`) ||
        (currentDateText.includes(targetMonthName.substring(0,3)) && 
         currentDateText.includes(` ${targetDay},`) ||
         currentDateText.includes(` ${targetDay} `))
      ) {
        console.log(`✅ Scheduler is on correct date!`);
        return;
      }
  
      // Click the forward arrow on the main scheduler toolbar
      console.log(`⏭️ Clicking next day...`);
      try {
        await this.page.click(
          '.k-scheduler-toolbar .k-nav-next, [data-testid="link-2"], button[aria-label="Next"]'
        );
        await this.page.waitForTimeout(500);
      } catch (e) {
        console.log('⚠️ Could not click next:', e.message);
        break;
      }
    }
  }
  
  async _selectDay(gameDate) {
    // When using the scheduler day view, the date is already selected by navigation
    // No need to click a calendar day
    console.log(`✅ Date already selected via scheduler navigation`);
  }

  /**
   * Shared helper: click on the correct day in the open calendar
   */
  async _selectDay(gameDate) {
    const day = gameDate.getDate();
    const month = gameDate.getMonth();
    const year = gameDate.getFullYear();

    console.log(`🗓️ Clicking on day ${day} (${month + 1}/${day}/${year})...`);

    try {
      await this.page.waitForSelector('.k-calendar', { timeout: 5000 });

      // Use evaluate to find exact day in the visible calendar
      // avoiding clicking days from prev/next month overflow
      const clicked = await this.page.evaluate((targetDay) => {
        const calendarCells = document.querySelectorAll('.k-calendar td[role="gridcell"]:not(.k-other-month) a, .k-calendar .k-link');
        for (const cell of calendarCells) {
          if (cell.textContent.trim() === targetDay.toString()) {
            cell.click();
            return true;
          }
        }
        return false;
      }, day);

      if (clicked) {
        console.log(`✅ Clicked day ${day} in current month`);
      } else {
        // Fallback: click by text
        await this.page.click(`text="${day}"`);
        console.log(`✅ Clicked day ${day} via text selector`);
      }
    } catch (e) {
      console.log('⚠️ Primary click failed, trying fallback...');
      await this.page.evaluate((targetDay) => {
        const allElements = document.querySelectorAll('a, button, td');
        for (const el of allElements) {
          if (el.textContent.trim() === targetDay.toString()) {
            el.click();
            break;
          }
        }
      }, day);
    }
  }

  /**
   * Shared helper: scroll to make PM time slots visible
   */
  async _scrollToTimeSlots() {
    await this.page.evaluate(() => {
      const schedulerContent = document.querySelector(
        '.k-scheduler-content, .k-scrollbar-v, [class*="scheduler-content"]'
      );
      if (schedulerContent) schedulerContent.scrollTop = schedulerContent.scrollHeight / 2;
      window.scrollTo(0, document.body.scrollHeight / 2);
    });
    await this.page.waitForTimeout(1000);

    // Also do a full scroll to ensure all slots are loaded
    await this.page.evaluate(() => {
      const schedulers = document.querySelectorAll('.k-scheduler-content, [role="presentation"]');
      schedulers.forEach(s => s.scrollTop = 99999);
      window.scrollTo(0, 99999);
    });
    await this.page.waitForTimeout(1500);
  }

  async bookCourt(gameDate, timeRange, courtName) {
    console.log(`📅 Booking court for ${gameDate.toLocaleDateString()} at ${timeRange.startDisplay}-${timeRange.endDisplay}`);
    
    try {
      console.log('📍 Current URL:', this.page.url());
      
      const portalUrl = 'https://app.courtreserve.com/Online/Portal/Index/6765';
      console.log('🏠 Going to portal home...');
      
      await this.page.goto(portalUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await this.page.waitForTimeout(2000);
      await this.page.screenshot({ path: 'step1-home.png' });
      console.log('📸 Step 1: Home page loaded');
      
      console.log('🔵 Clicking menu button...');
      await this.page.click('a[href="#menu"]');
      await this.page.waitForTimeout(1000);
      await this.page.screenshot({ path: 'step2-menu-open.png' });
      console.log('📸 Step 2: Menu opened');

      console.log('🏀 Clicking "Book Basketball"...');
      await this.page.click('a:has-text("Book Basketball"), button:has-text("Book Basketball")');
      await this.page.waitForTimeout(1000);
      await this.page.screenshot({ path: 'step3-book-basketball.png' });
      console.log('📸 Step 3: Book Basketball clicked');

      console.log('📋 Clicking "Book a Full Court"...');
      await this.page.click('a:has-text("Book a Full Court")');
      await this.page.waitForTimeout(2000);
      await this.page.screenshot({ path: 'step4-booking-calendar.png' });
      console.log('📸 Step 4: Booking calendar loaded');

      // Step 5: Open calendar and navigate to correct month
      await this._openAndNavigateCalendar(gameDate);
      await this.page.screenshot({ path: 'step5-calendar-opened.png' });
      console.log('📸 Step 5: Calendar on correct month');

      // Step 6: Click the correct day
      await this._selectDay(gameDate);
      await this.page.waitForTimeout(2000);
      await this.page.screenshot({ path: 'step6-date-selected.png' });
      console.log('📸 Step 6: Date selected');

      // Step 7: Scroll to time slots and find the right one
      console.log(`🕐 Looking for ${timeRange.startDisplay} Reserve button...`);
      await this.page.waitForTimeout(2000);

      const startHour24 = parseInt(timeRange.startTime.split(':')[0]);
      const displayHour = startHour24 > 12 ? startHour24 - 12 : startHour24;
      const amPm = startHour24 >= 12 ? 'PM' : 'AM';
      const timeLabel = `${displayHour}:00 ${amPm}`;

      console.log(`🔍 Looking for time slot: ${timeLabel} (${startHour24}:00 in 24h)`);

      console.log('📜 Scrolling down to find time slots...');
      await this._scrollToTimeSlots();
      await this.page.screenshot({ path: 'step7-scrolled.png' });

      // Check if slot is already booked
      console.log('🔍 Checking if slot is already booked...');
      const isAlreadyBooked = await this.page.evaluate((targetHour24) => {
        const displayHour = targetHour24 > 12 ? targetHour24 - 12 : targetHour24;
        const amPm = targetHour24 >= 12 ? 'PM' : 'AM';
        const exactHourRegex = new RegExp(`\\b${displayHour}:00 ${amPm}\\b`);
        const exactHourUrlRegex = new RegExp(`%20${displayHour}:00%20${amPm}`);
      
        const noneAvailableSlots = document.querySelectorAll(
          '.not-available-courts-container, [data-testid="noneAvailableBtn"], [class*="not-available"]'
        );
        for (const slot of noneAvailableSlots) {
          const dataTime = slot.getAttribute('data-time') || '';
          const parentAriaLabel = slot.closest('[aria-label]')?.getAttribute('aria-label') || '';
          const parentDataTime = slot.closest('[data-time]')?.getAttribute('data-time') || '';
          if (
            exactHourRegex.test(dataTime) ||
            exactHourRegex.test(parentAriaLabel) ||
            exactHourRegex.test(parentDataTime) ||
            exactHourUrlRegex.test(dataTime) ||
            exactHourUrlRegex.test(parentAriaLabel) ||
            exactHourUrlRegex.test(parentDataTime)
          ) {
            return true;
          }
        }
        return false;
      }, startHour24);

      if (isAlreadyBooked) {
        console.log(`❌ Time slot ${timeLabel} is already fully booked (NONE AVAILABLE)`);
        await this.page.screenshot({ path: 'slot-already-booked.png', fullPage: false });
        return {
          success: false,
          alreadyBooked: true,
          message: `The ${timeLabel} slot is already fully booked`,
          screenshots: { failure: 'slot-already-booked.png' }
        };
      }

      // Find and click Reserve button
      const reserveButtons = await this.page.$$('a.slot-btn, a.btn-consolidate-slot, [class*="slot-btn"]');
      console.log(`Found ${reserveButtons.length} reserve buttons`);

      let timeSlotClicked = false;

      for (const button of reserveButtons) {
        try {
          const ariaLabel = await button.getAttribute('aria-label') || '';
          const dataHref = await button.getAttribute('data-href') || '';
          if (ariaLabel) console.log(`Checking button: ${ariaLabel.substring(0, 80)}`);
          else if (dataHref) console.log(`Checking button href: ${dataHref.substring(0, 80)}`);
          
            // Use regex to match exact hour - prevents "1:00" matching "12:00"
            // URL format: "2026%201:00%20PM" - we match hour preceded by "%20" 
            const exactHourRegex = new RegExp(`%20${displayHour}:00%20${amPm}`);
            const exact24hRegex = new RegExp(`%20${startHour24}:00%20`);

            const matchesTime = 
            ariaLabel.includes(timeLabel) ||
            exactHourRegex.test(dataHref) ||
            exact24hRegex.test(dataHref);
          
          if (matchesTime) {
            console.log(`✅ Found correct time slot: ${timeLabel}`);
            await button.scrollIntoViewIfNeeded();
            await this.page.waitForTimeout(500);
            await button.click();
            timeSlotClicked = true;
            await this.page.waitForTimeout(2000);
            break;
          }
        } catch (e) {}
      }

      if (!timeSlotClicked) {
        console.log('❌ Could not find time slot, taking screenshot...');
        await this.page.screenshot({ path: 'time-slot-not-found.png' });
        return {
          success: false,
          message: `Could not find time slot: ${timeLabel}`,
          screenshots: { failure: 'time-slot-not-found.png' }
        };
      }

      await this.page.screenshot({ path: 'step7-timeslot.png' });
      console.log('📸 Step 7: Time slot clicked');

      // Step 8: Handle confirmation popup
      console.log('🎯 Waiting for confirmation popup...');
      await this.page.waitForTimeout(2000);

      const confirmSelectors = [
        'button:has-text("Confirm")', 'button:has-text("Complete Reservation")',
        'button:has-text("Submit")', '.modal button:has-text("Book")',
        '.modal button[type="submit"]', 'button:has-text("Reserve")',
        '[class*="modal"] button'
      ];

      let confirmed = false;
      for (const selector of confirmSelectors) {
        try {
          await this.page.waitForSelector(selector, { timeout: 5000 });
          const element = await this.page.$(selector);
          if (element) {
            console.log(`✅ Found confirmation button: ${selector}`);
            await element.click();
            confirmed = true;
            await this.page.waitForTimeout(2000);
            break;
          }
        } catch (e) {}
      }

      await this.page.screenshot({ path: 'step8-confirmation.png', fullPage: true });
      console.log('📸 Step 8: Confirmation page screenshot saved');

      // Navigate back to show booked slot on calendar
      console.log('📅 Navigating back to show booked slot on calendar...');
      await this.page.goto('https://app.courtreserve.com/Online/Portal/Index/6765', {
        waitUntil: 'domcontentloaded', timeout: 30000
      });
      await this.page.waitForTimeout(1000);
      await this.page.click('a[href="#menu"]');
      await this.page.waitForTimeout(1000);
      await this.page.click('a:has-text("Book Basketball")');
      await this.page.waitForTimeout(1000);
      await this.page.click('a:has-text("Book a Full Court")');
      await this.page.waitForTimeout(2000);

      await this.page.evaluate(() => {
        const schedulerContent = document.querySelector('.k-scheduler-content, [class*="scheduler-content"]');
        if (schedulerContent) schedulerContent.scrollTop = schedulerContent.scrollHeight / 2;
      });
      await this.page.waitForTimeout(1000);

      await this.page.screenshot({ path: 'step9-booked-calendar.png', fullPage: true });
      console.log('📸 Step 9: Booked calendar screenshot saved');

      if (confirmed) {
        console.log('✅ Booking completed successfully!');
        return { 
          success: true, 
          screenshots: {
            confirmation: 'step8-confirmation.png',
            calendar: 'step9-booked-calendar.png'
          }
        };
      } else {
        console.log('⚠️ Could not find confirmation button - check screenshots');
        return { 
          success: false, 
          message: 'Could not find confirmation button',
          screenshots: {
            confirmation: 'step8-confirmation.png',
            calendar: 'step9-booked-calendar.png'
          }
        };
      }

    } catch (error) {
      console.error('❌ Booking failed:', error.message);
      await this.page.screenshot({ path: 'booking-error.png' });
      return { 
        success: false, 
        error: error.message,
        screenshots: { failure: 'booking-error.png' }
      };
    }
  }

  async checkAvailability(gameDate, timeRange) {
    console.log(`🔍 Checking availability for ${gameDate.toLocaleDateString()} at ${timeRange.startDisplay}`);

    try {
      console.log('📍 Current URL:', this.page.url());

      await this.page.goto('https://app.courtreserve.com/Online/Portal/Index/6765', {
        waitUntil: 'domcontentloaded', timeout: 30000
      });
      await this.page.waitForTimeout(2000);

      await this.page.click('a[href="#menu"]');
      await this.page.waitForTimeout(1000);

      await this.page.click('a:has-text("Book Basketball"), button:has-text("Book Basketball")');
      await this.page.waitForTimeout(1000);

      await this.page.click('a:has-text("Book a Full Court")');
      await this.page.waitForTimeout(2000);

      // Open calendar and navigate to correct month
      await this._openAndNavigateCalendar(gameDate);

      // Click the correct day
      await this._selectDay(gameDate);
      await this.page.waitForTimeout(2000);

      // Scroll to time slots
      await this._scrollToTimeSlots();

      const startHour24 = parseInt(timeRange.startTime.split(':')[0]);
      const displayHour = startHour24 > 12 ? startHour24 - 12 : startHour24;
      const amPm = startHour24 >= 12 ? 'PM' : 'AM';
      const timeLabel = `${displayHour}:00 ${amPm}`;

      console.log(`🔍 Checking slot: ${timeLabel}`);
      const slotStatus = await this.page.evaluate((targetHour24) => {
        const displayHour = targetHour24 > 12 ? targetHour24 - 12 : targetHour24;
        const amPm = targetHour24 >= 12 ? 'PM' : 'AM';
        const hourStr = `${displayHour}:00 ${amPm}`;
      
        // Use exact word boundary matching to avoid "10" matching inside "none available" checks
        const exactHourRegex = new RegExp(`\\b${displayHour}:00 ${amPm}\\b`);
        const exactHourUrlRegex = new RegExp(`%20${displayHour}:00%20${amPm}`);
        const exact24hUrlRegex = new RegExp(`%20${targetHour24}:00%20`);
      
        // Check NONE AVAILABLE slots - use exact match
        const noneAvailable = document.querySelectorAll(
          '.not-available-courts-container, [data-testid="noneAvailableBtn"], [class*="not-available"]'
        );
        for (const slot of noneAvailable) {
          const dataTime = slot.getAttribute('data-time') || '';
          const parentAriaLabel = slot.closest('[aria-label]')?.getAttribute('aria-label') || '';
          const parentDataTime = slot.closest('[data-time]')?.getAttribute('data-time') || '';
      
          // Use exact regex match - "10:00 PM" won't match "9:00 PM" etc
          if (
            exactHourRegex.test(dataTime) ||
            exactHourRegex.test(parentAriaLabel) ||
            exactHourRegex.test(parentDataTime) ||
            exactHourUrlRegex.test(dataTime) ||
            exactHourUrlRegex.test(parentAriaLabel) ||
            exactHourUrlRegex.test(parentDataTime)
          ) {
            return 'unavailable';
          }
        }
      
        // Check Reserve buttons - use exact URL match
        const reserveButtons = document.querySelectorAll('a.slot-btn, a.btn-consolidate-slot, [class*="slot-btn"]');
        for (const btn of reserveButtons) {
          const ariaLabel = btn.getAttribute('aria-label') || '';
          const dataHref = btn.getAttribute('data-href') || '';
      
          if (
            exactHourRegex.test(ariaLabel) ||
            exactHourUrlRegex.test(dataHref) ||
            exact24hUrlRegex.test(dataHref)
          ) {
            return 'available';
          }
        }
      
        return 'unknown';
      }, startHour24);

      await this.page.screenshot({ path: 'availability-check.png' });
      console.log(`📸 Availability check screenshot saved - Status: ${slotStatus}`);

      return {
        status: slotStatus,
        timeLabel,
        screenshot: 'availability-check.png'
      };

    } catch (error) {
      console.error('❌ Availability check failed:', error.message);
      try {
        await this.page.screenshot({ path: 'availability-check-error.png' });
      } catch (e) {}
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