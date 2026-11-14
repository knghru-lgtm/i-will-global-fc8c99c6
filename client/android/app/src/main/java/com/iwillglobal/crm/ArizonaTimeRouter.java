package com.iwillglobal.crm;

import java.time.DayOfWeek;
import java.time.LocalDate;
import java.time.LocalTime;
import java.time.ZoneId;
import java.time.ZonedDateTime;
import java.time.temporal.TemporalAdjusters;

/**
 * Evaluates incoming call timestamps strictly in 'America/Phoenix' (MST, UTC-7 year-round, no DST).
 * Business Hours: Monday through Friday, 8:00 AM - 5:00 PM MST (excluding US Federal Holidays).
 */
public final class ArizonaTimeRouter {
    public static final ZoneId PHOENIX_ZONE = ZoneId.of("America/Phoenix");
    public static final LocalTime OFFICE_START = LocalTime.of(8, 0);  // 8:00 AM MST
    public static final LocalTime OFFICE_END = LocalTime.of(17, 0);   // 5:00 PM MST

    public static final String BUSINESS_HOURS_GREETING =
        "Thank you for calling IWG Insurance and Financial Services, where we serve as your 100% free fiduciary advisory representing over 104 premier carriers with zero broker fees. This is Sarah speaking. How may I direct your call today?";

    public static final String AFTER_HOURS_GREETING =
        "Thank you for calling I Will Global. Our office is currently closed. Our regular business hours are Monday through Friday, from 8 AM to 5 PM Arizona time. Please call us back during normal business hours. Have a wonderful day.";

    private ArizonaTimeRouter() {}

    public static boolean isBusinessHoursNow() {
        return isBusinessHours(ZonedDateTime.now(PHOENIX_ZONE));
    }

    public static boolean isBusinessHours(ZonedDateTime phoenixNow) {
        ZonedDateTime azTime = phoenixNow.withZoneSameInstant(PHOENIX_ZONE);
        DayOfWeek dow = azTime.getDayOfWeek();
        if (dow == DayOfWeek.SATURDAY || dow == DayOfWeek.SUNDAY) {
            return false;
        }
        if (isArizonaHoliday(azTime.toLocalDate())) {
            return false;
        }
        LocalTime localTime = azTime.toLocalTime();
        return !localTime.isBefore(OFFICE_START) && localTime.isBefore(OFFICE_END);
    }

    public static boolean isArizonaHoliday(LocalDate date) {
        int year = date.getYear();
        if (isObservedFixedHoliday(date, LocalDate.of(year, 1, 1))) return true;   // New Year's Day
        if (isObservedFixedHoliday(date, LocalDate.of(year, 6, 19))) return true;  // Juneteenth
        if (isObservedFixedHoliday(date, LocalDate.of(year, 7, 4))) return true;   // Independence Day
        if (isObservedFixedHoliday(date, LocalDate.of(year, 11, 11))) return true; // Veterans Day
        if (isObservedFixedHoliday(date, LocalDate.of(year, 12, 25))) return true; // Christmas Day

        // MLK Jr. Day: 3rd Monday in January
        if (date.equals(LocalDate.of(year, 1, 1).with(TemporalAdjusters.dayOfWeekInMonth(3, DayOfWeek.MONDAY)))) {
            return true;
        }
        // Presidents' Day: 3rd Monday in February
        if (date.equals(LocalDate.of(year, 2, 1).with(TemporalAdjusters.dayOfWeekInMonth(3, DayOfWeek.MONDAY)))) {
            return true;
        }
        // Memorial Day: Last Monday in May
        if (date.equals(LocalDate.of(year, 5, 1).with(TemporalAdjusters.lastInMonth(DayOfWeek.MONDAY)))) {
            return true;
        }
        // Labor Day: 1st Monday in September
        if (date.equals(LocalDate.of(year, 9, 1).with(TemporalAdjusters.dayOfWeekInMonth(1, DayOfWeek.MONDAY)))) {
            return true;
        }
        // Thanksgiving Day: 4th Thursday in November
        if (date.equals(LocalDate.of(year, 11, 1).with(TemporalAdjusters.dayOfWeekInMonth(4, DayOfWeek.THURSDAY)))) {
            return true;
        }
        return false;
    }

    private static boolean isObservedFixedHoliday(LocalDate date, LocalDate holiday) {
        if (date.equals(holiday)) return true;
        if (holiday.getDayOfWeek() == DayOfWeek.SATURDAY && date.equals(holiday.minusDays(1))) {
            return true;
        }
        if (holiday.getDayOfWeek() == DayOfWeek.SUNDAY && date.equals(holiday.plusDays(1))) {
            return true;
        }
        return false;
    }
}

