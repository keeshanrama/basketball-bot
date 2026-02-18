import CourtReserveBooker from './src/booking.js';  // Added 'src/'
import dotenv from 'dotenv';

dotenv.config();

async function test() {
  const booker = new CourtReserveBooker();
  await booker.initialize();
  
  // Test booking Feb 18, 9-11pm
  const testDate = new Date(2026, 1, 18); // Feb 18, 2026
  const testTime = {
    startTime: "21:00",
    endTime: "23:00",
    startDisplay: "9:00 PM",
    endDisplay: "11:00 PM"
  };
  
  await booker.bookCourt(testDate, testTime, "Fmt Procourt");
  await booker.close();
}

test();