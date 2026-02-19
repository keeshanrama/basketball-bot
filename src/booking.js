import { firefox } from 'playwright';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

dotenv.config({ path: join(__dirname, '..', '.env') });

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June',
                     'July', 'August', 'September', 'October', 'November', 'December'];

const MAX_RETRIES = 2;

class CourtReserveBooker {
  constructor() {
    this.browser = null;
    this.context = null;
    this.page = null;
  }

  async initialize() {
    console.log('🌐 Launching browser...');
    
    const isHeadless = process.env.HEADLESS !== 'false';
    console.log(`🖥️  Browser headless mode: ${isHeadless}`);
    
    this.browser = await firefox.launch({
      headless: isHeadless,
      slowMo: isHeadless ? 50 : 100,
    });

    this.context = await this.browser.newContext({
      viewport: { width: 1280, height: 720 },
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36'
    });

    this.page = await this.context.newPage();
    
    // Set default timeouts
    this.page.setDefaultTimeout(15000);
    this.page.setDefaultNavigationTimeout(30000);

    await this.login();
  }

  async login() {
    console.log('🔐 Logging in to CourtReserve...');
    
    try {
      await this.page.goto(process.env.COURTRESERVE_PORTAL_URL, {
        waitUntil: 'networkidle',
        timeout: 30000
      });

      console.log('📸 Landing page loaded, looking for LOG IN button...');
      await this.page.click('button:has-text("LOG IN"), a:has-text("LOG IN")');
      console.log('✅ Clicked LOG IN button');

      await this.page.waitForSelector('input[placeholder*="Email"], input[placeholder*="email"]', {
        timeout: 10000
      });

      console.log('📝 Filling in credentials...');
      await this.page.fill('input[placeholder*="Email"], input[placeholder*="email"]', process.env.COURTRESERVE_USERNAME);
      await this.page.fill('input[placeholder*="Password"], input[placeholder*="password"]', process.env.COURTRESERVE_PASSWORD);

      await this.page.waitForTimeout(500);
      console.log('🔘 Clicking Continue button...');
      await this.page.click('button:has-text("Continue")');
      await this.page.waitForLoadState('networkidle', { timeout: 15000 });

      console.log('✅ Successfully logged in');
      
    } catch (error) {
      console.error('❌ Login failed:', error.message);
      try { await this.page.screenshot({ path: 'login-error.png' }); } catch (e) {}
      throw error;
    }
  }

  /**
   * Navigate to the scheduler for a specific date.
   * Uses day-by-day navigation but with faster clicks and recovery.
   */
  async _navigateToDate(gameDate) {
    const targetMonthName = MONTH_NAMES[gameDate.getMonth()];
    const targetDay = gameDate.getDate();
    
    console.log(`📅 Navigating to ${targetMonthName} ${targetDay}, ${gameDate.getFullYear()}...`);
    
    // Navigate to portal and go through menu
    await this.page.goto('https://app.courtreserve.com/Online/Portal/Index/6765', {
      waitUntil: 'domcontentloaded', timeout: 30000
    });
    await this.page.waitForTimeout(1500);

    await this.page.click('a[href="#menu"]');
    await this.page.waitForTimeout(800);

    await this.page.click('a:has-text("Book Basketball"), button:has-text("Book Basketball")');
    await this.page.waitForTimeout(800);

    await this.page.click('a:has-text("Book a Full Court")');
    await this.page.waitForTimeout(1500);

    // Calculate days to navigate
    const today = new Date();
    today.setHours(0,0,0,0);
    const target = new Date(gameDate);
    target.setHours(0,0,0,0);
    const daysDiff = Math.round((target - today) / (1000 * 60 * 60 * 24));
    
    console.log(`📅 Need to navigate ${daysDiff} days forward`);
    
    if (daysDiff <= 0) {
      console.log(`✅ Target date is today or past`);
      return;
    }

    // Click "next" with fast intervals and periodic verification
    for (let i = 0; i < daysDiff; i++) {
      try {
        await this.page.click(
          '.k-scheduler-toolbar .k-nav-next, [data-testid="link-2"], button[aria-label="Next"]',
          { timeout: 5000 }
        );
        // Short wait between clicks, longer pause every 7 days to let page catch up
        if ((i + 1) % 7 === 0) {
          await this.page.waitForTimeout(800);
        } else {
          await this.page.waitForTimeout(250);
        }
      } catch (e) {
        console.log(`⚠️ Click failed at day ${i + 1}/${daysDiff}, waiting and retrying...`);
        await this.page.waitForTimeout(2000);
        try {
          await this.page.click('button[aria-label="Next"]', { timeout: 5000 });
          await this.page.waitForTimeout(300);
        } catch (e2) {
          console.log(`❌ Recovery failed at day ${i + 1}`);
          break;
        }
      }
    }

    // Wait for final page to settle
    await this.page.waitForTimeout(1000);

    // Verify we landed on the right date
    const currentDateText = await this.page.$eval(
      '.k-scheduler-toolbar .k-nav-current, [data-testid="link-0"], .fn-scheduler-toolbar-name',
      el => el.textContent.trim()
    ).catch(() => '');
    
    console.log(`📅 Scheduler now showing: "${currentDateText}"`);
    
    if (currentDateText.includes(`${targetMonthName} ${targetDay}`) || 
        currentDateText.includes(`${targetMonthName.substring(0,3)} ${targetDay}`)) {
      console.log(`✅ Successfully navigated to target date!`);
    } else {
      console.log(`⚠️ May not be on correct date. Expected ${targetMonthName} ${targetDay}`);
    }
  }

  /**
   * Scroll to make PM time slots visible
   */
  async _scrollToTimeSlots() {
    await this.page.evaluate(() => {
      const schedulerContent = document.querySelector(
        '.k-scheduler-content, .k-scrollbar-v, [class*="scheduler-content"]'
      );
      if (schedulerContent) schedulerContent.scrollTop = schedulerContent.scrollHeight / 2;
      window.scrollTo(0, document.body.scrollHeight / 2);
    });
    await this.page.waitForTimeout(800);

    await this.page.evaluate(() => {
      const schedulers = document.querySelectorAll('.k-scheduler-content, [role="presentation"]');
      schedulers.forEach(s => s.scrollTop = 99999);
      window.scrollTo(0, 99999);
    });
    await this.page.waitForTimeout(1000);
  }

  /**
   * Check slot status for a given hour
   */
  async _getSlotStatus(startHour24) {
    return await this.page.evaluate((targetHour24) => {
      const displayHour = targetHour24 > 12 ? targetHour24 - 12 : targetHour24;
      const amPm = targetHour24 >= 12 ? 'PM' : 'AM';
      const exactHourRegex = new RegExp(`\\b${displayHour}:00 ${amPm}\\b`);
      const exactHourUrlRegex = new RegExp(`%20${displayHour}:00%20${amPm}`);
      const exact24hUrlRegex = new RegExp(`%20${targetHour24}:00%20`);
    
      // Check NONE AVAILABLE slots
      const noneAvailable = document.querySelectorAll(
        '.not-available-courts-container, [data-testid="noneAvailableBtn"], [class*="not-available"]'
      );
      for (const slot of noneAvailable) {
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
          return 'unavailable';
        }
      }
    
      // Check Reserve buttons
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
  }

  async bookCourt(gameDate, timeRange, courtName) {
    console.log(`📅 Booking court for ${gameDate.toLocaleDateString()} at ${timeRange.startDisplay}-${timeRange.endDisplay}`);
    
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        if (attempt > 1) {
          console.log(`🔄 Retry attempt ${attempt}/${MAX_RETRIES}...`);
          try { await this.close(); } catch (e) {}
          await this.initialize();
        }

        return await this._doBookCourt(gameDate, timeRange, courtName);
      } catch (error) {
        console.error(`❌ Booking attempt ${attempt} failed: ${error.message}`);
        if (attempt === MAX_RETRIES) {
          try { await this.page.screenshot({ path: 'booking-error.png' }); } catch (e) {}
          return { 
            success: false, 
            error: error.message,
            screenshots: { failure: 'booking-error.png' }
          };
        }
      }
    }
  }

  async _doBookCourt(gameDate, timeRange, courtName) {
    // Navigate to the correct date
    await this._navigateToDate(gameDate);

    const startHour24 = parseInt(timeRange.startTime.split(':')[0]);
    const displayHour = startHour24 > 12 ? startHour24 - 12 : startHour24;
    const amPm = startHour24 >= 12 ? 'PM' : 'AM';
    const timeLabel = `${displayHour}:00 ${amPm}`;

    console.log(`🔍 Looking for time slot: ${timeLabel}`);

    // Scroll to time slots
    await this._scrollToTimeSlots();

    // Check if already booked
    const slotStatus = await this._getSlotStatus(startHour24);
    if (slotStatus === 'unavailable') {
      console.log(`❌ Time slot ${timeLabel} is already fully booked`);
      await this.page.screenshot({ path: 'slot-already-booked.png' });
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
    const exactHourRegex = new RegExp(`%20${displayHour}:00%20${amPm}`);

    for (const button of reserveButtons) {
      try {
        const ariaLabel = await button.getAttribute('aria-label') || '';
        const dataHref = await button.getAttribute('data-href') || '';
        
        const matchesTime = 
          ariaLabel.includes(timeLabel) ||
          exactHourRegex.test(dataHref);
        
        if (matchesTime) {
          console.log(`✅ Found correct time slot: ${timeLabel}`);
          await button.scrollIntoViewIfNeeded();
          await this.page.waitForTimeout(300);
          await button.click();
          timeSlotClicked = true;
          await this.page.waitForTimeout(2000);
          break;
        }
      } catch (e) {}
    }

    if (!timeSlotClicked) {
      console.log('❌ Could not find time slot');
      await this.page.screenshot({ path: 'time-slot-not-found.png' });
      return {
        success: false,
        message: `Could not find time slot: ${timeLabel}`,
        screenshots: { failure: 'time-slot-not-found.png' }
      };
    }

    await this.page.screenshot({ path: 'step-timeslot.png' });

    // Handle confirmation popup
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

    await this.page.screenshot({ path: 'step-confirmation.png', fullPage: true });

    if (confirmed) {
      console.log('✅ Booking completed successfully!');
      return { 
        success: true, 
        screenshots: {
          confirmation: 'step-confirmation.png'
        }
      };
    } else {
      console.log('⚠️ Could not find confirmation button - check screenshots');
      return { 
        success: false, 
        message: 'Could not find confirmation button',
        screenshots: {
          confirmation: 'step-confirmation.png'
        }
      };
    }
  }

  async checkAvailability(gameDate, timeRange) {
    console.log(`🔍 Checking availability for ${gameDate.toLocaleDateString()} at ${timeRange.startDisplay}`);

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        if (attempt > 1) {
          console.log(`🔄 Retry attempt ${attempt}/${MAX_RETRIES}...`);
          try { await this.close(); } catch (e) {}
          await this.initialize();
        }

        return await this._doCheckAvailability(gameDate, timeRange);
      } catch (error) {
        console.error(`❌ Availability check attempt ${attempt} failed: ${error.message}`);
        if (attempt === MAX_RETRIES) {
          try { await this.page.screenshot({ path: 'availability-check-error.png' }); } catch (e) {}
          return {
            status: 'error',
            error: error.message,
            screenshot: 'availability-check-error.png'
          };
        }
      }
    }
  }

  async _doCheckAvailability(gameDate, timeRange) {
    // Navigate to the correct date
    await this._navigateToDate(gameDate);

    // Scroll to time slots
    await this._scrollToTimeSlots();

    const startHour24 = parseInt(timeRange.startTime.split(':')[0]);
    const displayHour = startHour24 > 12 ? startHour24 - 12 : startHour24;
    const amPm = startHour24 >= 12 ? 'PM' : 'AM';
    const timeLabel = `${displayHour}:00 ${amPm}`;

    console.log(`🔍 Checking slot: ${timeLabel}`);
    const slotStatus = await this._getSlotStatus(startHour24);

    await this.page.screenshot({ path: 'availability-check.png' });
    console.log(`📸 Availability check - Status: ${slotStatus}`);

    return {
      status: slotStatus,
      timeLabel,
      screenshot: 'availability-check.png'
    };
  }

  async screenshot(filename) {
    if (this.page) {
      try { await this.page.screenshot({ path: filename }); } catch (e) {}
    }
  }

  async close() {
    if (this.browser) {
      try { await this.browser.close(); } catch (e) {}
      this.browser = null;
      this.context = null;
      this.page = null;
      console.log('🔒 Browser closed');
    }
  }
}

export default CourtReserveBooker;