/**
 * מחשב האם הטקסט צריך להיות שחור או לבן על סמך צבע הרקע (HEX)
 * @param {string} hexColor - צבע הרקע בפורמט HEX (למשל #ffffff)
 * @returns {string} - '#ffffff' או '#000000'
 */
export const getContrastColor = (hexColor) => {
    if (!hexColor) return '#ffffff';
    
    // הסרת ה-# אם קיים
    const hex = hexColor.replace('#', '');
    
    // המרה ל-RGB
    const r = parseInt(hex.substr(0, 2), 16);
    const g = parseInt(hex.substr(2, 2), 16);
    const b = parseInt(hex.substr(4, 2), 16);
    
    // חישוב בהירות (YIQ formula)
    const yiq = ((r * 299) + (g * 587) + (b * 114)) / 1000;
    
    // אם הבהירות מעל 128, הרקע בהיר ולכן הטקסט צריך להיות שחור
    return (yiq >= 128) ? '#000000' : '#ffffff';
};

/**
 * מוודא שהצבע כהה מספיק לטקסט לבן
 * אם הצבע בהיר מדי - מחשיך אותו
 * @param {string} hexColor - צבע בפורמט HEX
 * @param {number} threshold - סף בהירות (ברירת מחדל: 150)
 * @returns {string} - צבע מתוקן בפורמט HEX
 */
export const ensureDarkEnough = (hexColor, threshold = 150) => {
    if (!hexColor) return '#579bfc';
    
    // הסרת ה-# אם קיים
    const hex = hexColor.replace('#', '');
    
    // טיפול ב-hex מקוצר (3 תווים)
    let fullHex = hex;
    if (hex.length === 3) {
        fullHex = hex.split('').map(char => char + char).join('');
    }
    
    let r = parseInt(fullHex.substr(0, 2), 16);
    let g = parseInt(fullHex.substr(2, 2), 16);
    let b = parseInt(fullHex.substr(4, 2), 16);
    
    // חישוב בהירות YIQ
    const yiq = ((r * 299) + (g * 587) + (b * 114)) / 1000;
    
    // אם הצבע בהיר מדי, נחשיך אותו
    if (yiq > threshold) {
        const darkenFactor = threshold / yiq;
        r = Math.floor(r * darkenFactor);
        g = Math.floor(g * darkenFactor);
        b = Math.floor(b * darkenFactor);
    }
    
    return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
};

/**
 * פלטת הצבעים הרשמית של Monday.com (מ-Vibe Design System)
 * צבעים חיים (ירוק, צהוב, כתום, אדום, ורוד, סגול, כחול) ראשונים - מועדפים
 * צבעים ניטרליים (חום, אפור, בז') אחרונים
 */
export const MONDAY_COLORS = [
    // === צבעים חיים - מועדפים (80% מהפרויקטים) ===
    '#00c875', // done-green (ירוק בהיר)
    '#fdab3d', // working_orange (כתום)
    '#df2f4a', // stuck-red (אדום)
    '#9d50dd', // purple (סגול)
    '#579bfc', // bright-blue (כחול)
    '#ffcb00', // egg_yolk (צהוב)
    '#ff5ac4', // lipstick (ורוד בהיר)
    '#9cd326', // bright-green (ירוק-צהוב)
    '#ff6d3b', // dark-orange (כתום כהה)
    '#4eccc6', // aquamarine (טורקיז)
    '#bb3354', // dark-red (אדום כהה)
    '#784bd1', // dark_purple (סגול כהה)
    '#66ccff', // chili-blue (תכלת)
    '#e50073', // sofia_pink (ורוד חזק)
    '#037f4c', // grass_green (ירוק כהה)
    '#cab641', // saladish (חרדל)
    '#5559df', // indigo (אינדיגו)
    '#ff7575', // sunset (שקיעה)
    '#faa1f1', // bubble (ורוד בועות)
    '#ffadad', // peach (אפרסק)
    '#216edf', // royal (כחול מלכותי)
    '#bda8f9', // lavender (לבנדר)
    '#e484bd', // orchid (סחלב)
    '#007eb5', // dark-blue (כחול כהה)
    
    // === צבעים ניטרליים - פחות מועדפים (20%) ===
    '#74afcc', // river (כחול-אפור)
    '#a1e3f6', // sky (שמיים)
    '#9aadbd', // winter (אפור-כחול)
    '#a9bee8', // steel (פלדה)
    '#9d99b9', // lilac (לילך)
    '#7f5347', // brown (חום)
    '#bca58a', // tan (בז')
    '#cd9282', // coffee (קפה)
    '#563e3e', // pecan (פקאן)
];

// מספר הצבעים החיים (לשימוש בהסתברות מוטה)
const VIBRANT_COLORS_COUNT = 24;

/**
 * 40 צבעי התוכן הרשמיים של Vibe (כפי שמופיעים ב-ColorPicker).
 * סדר התצוגה: ירוק → צהוב → כתום → אדום → ורוד → סגול → כחול → טורקיז → אפור → חום.
 * צבעים נוספים שאינם ב-content colors (כמו working-orange) קיימים במפה הרחבה למטה.
 */
export const VIBE_CONTENT_COLORS = [
    'grass_green', 'done-green', 'bright-green', 'saladish', 'egg_yolk',
    'working_orange', 'dark-orange', 'peach', 'sunset', 'stuck-red',
    'dark-red', 'sofia_pink', 'lipstick', 'bubble', 'purple',
    'dark_purple', 'berry', 'dark_indigo', 'indigo', 'navy',
    'bright-blue', 'dark-blue', 'aquamarine', 'chili-blue', 'river',
    'winter', 'explosive', 'american_gray', 'blackish', 'brown',
    'orchid', 'tan', 'sky', 'coffee', 'royal',
    'teal', 'lavender', 'steel', 'lilac', 'pecan'
];

/**
 * מיפוי קנוני: שם צבע Vibe → HEX (מתוך docs/monday-vibe-tokens-full.json).
 * זהו המקור היחיד לאמת בכל הקשור לערכי צבעי Monday.
 */
export const VIBE_COLOR_TO_HEX = {
    grass_green: '#037f4c',
    'done-green': '#00c875',
    'bright-green': '#9cd326',
    saladish: '#cab641',
    egg_yolk: '#ffcb00',
    working_orange: '#fdab3d',
    'dark-orange': '#ff6d3b',
    peach: '#ffadad',
    sunset: '#ff7575',
    'stuck-red': '#df2f4a',
    'dark-red': '#bb3354',
    sofia_pink: '#e50073',
    lipstick: '#ff5ac4',
    bubble: '#faa1f1',
    purple: '#9d50dd',
    dark_purple: '#784bd1',
    berry: '#7e3b8a',
    dark_indigo: '#401694',
    indigo: '#5559df',
    navy: '#225091',
    'bright-blue': '#579bfc',
    'dark-blue': '#007eb5',
    aquamarine: '#4eccc6',
    'chili-blue': '#66ccff',
    river: '#74afcc',
    winter: '#9aadbd',
    explosive: '#c4c4c4',
    american_gray: '#757575',
    blackish: '#333333',
    brown: '#7f5347',
    orchid: '#e484bd',
    tan: '#bca58a',
    sky: '#a1e3f6',
    coffee: '#cd9282',
    royal: '#216edf',
    teal: '#175a63',
    lavender: '#bda8f9',
    steel: '#a9bee8',
    lilac: '#9d99b9',
    pecan: '#563e3e'
};

// מיפוי הפוך: HEX → שם Vibe
const HEX_TO_VIBE = Object.entries(VIBE_COLOR_TO_HEX).reduce((acc, [name, hex]) => {
    acc[hex.toLowerCase()] = name;
    return acc;
}, {});

/**
 * ממיר HEX (כגון "#fdab3d") לשם צבע Vibe (כגון "working_orange").
 * @returns {string|null} שם או null אם אין התאמה.
 */
export const hexToVibeColor = (hex) => {
    if (!hex || typeof hex !== 'string') return null;
    return HEX_TO_VIBE[hex.toLowerCase()] || null;
};

// מיפוי שמות צבעי Monday → HEX (כפי שנשמרים ב-settings של עמודת Status)
const MONDAY_COLOR_NAME_TO_HEX = {
    'done-green':     '#00c875',
    'done_green':     '#00c875',
    'working_orange': '#fdab3d',
    'working-orange': '#fdab3d',
    'stuck_red':      '#df2f4a',
    'stuck-red':      '#df2f4a',
    'purple':         '#9d50dd',
    'bright_blue':    '#579bfc',
    'bright-blue':    '#579bfc',
    'egg_yolk':       '#ffcb00',
    'egg-yolk':       '#ffcb00',
    'lipstick':       '#ff5ac4',
    'bright_green':   '#9cd326',
    'bright-green':   '#9cd326',
    'dark_orange':    '#ff6d3b',
    'dark-orange':    '#ff6d3b',
    'aquamarine':     '#4eccc6',
    'dark_red':       '#bb3354',
    'dark-red':       '#bb3354',
    'dark_purple':    '#784bd1',
    'dark-purple':    '#784bd1',
    'chili_blue':     '#66ccff',
    'chili-blue':     '#66ccff',
    'sofia_pink':     '#e50073',
    'sofia-pink':     '#e50073',
    'grass_green':    '#037f4c',
    'grass-green':    '#037f4c',
    'saladish':       '#cab641',
    'indigo':         '#5559df',
    'sunset':         '#ff7575',
    'bubble':         '#faa1f1',
    'peach':          '#ffadad',
    'royal':          '#216edf',
    'lavender':       '#bda8f9',
    'orchid':         '#e484bd',
    'dark_blue':      '#007eb5',
    'dark-blue':      '#007eb5',
    'river':          '#74afcc',
    'sky':            '#a1e3f6',
    'winter':         '#9aadbd',
    'steel':          '#a9bee8',
    'lilac':          '#9d99b9',
    'brown':          '#7f5347',
    'tan':            '#bca58a',
    'coffee':         '#cd9282',
    'pecan':          '#563e3e',
    'null':           '#c4c4c4',
};

/**
 * ממיר שם צבע של Monday (כגון "working_orange") ל-HEX
 * @param {string} color - שם צבע של Monday או HEX
 * @returns {string|null} - HEX או null אם לא נמצא
 */
export const mondayColorToHex = (color) => {
    if (!color || typeof color !== 'string') return null;
    if (color.startsWith('#')) return color;
    return MONDAY_COLOR_NAME_TO_HEX[color.toLowerCase()] || null;
};

/**
 * יוצר hash מספרי ממחרוזת
 * @param {string} str - מחרוזת כלשהי
 * @returns {number} - מספר hash חיובי
 */
const hashString = (str) => {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
        hash = str.charCodeAt(i) + ((hash << 5) - hash);
    }
    return Math.abs(hash);
};

/**
 * יוצר צבע עקבי ממחרוזת (כגון מזהה פרויקט)
 * משתמש בפלטת Monday עם העדפה לצבעים חיים (ירוק, צהוב, כתום, אדום, ורוד, סגול, כחול)
 * @param {string} stringInput - מחרוזת כלשהי (לדוגמה: מזהה פרויקט)
 * @returns {string} - צבע בפורמט HEX מפלטת Monday
 */
export const stringToColor = (stringInput) => {
    if (!stringInput) return '#579bfc';  // bright-blue כברירת מחדל
    
    const hash = hashString(stringInput.toString());
    
    // שימוש ב-Golden Ratio לפיזור אופטימלי
    const goldenRatio = 0.618033988749895;
    
    // 80% סיכוי לצבע חי (מ-24 הראשונים), 20% מכל המערך
    const useVibrant = (hash % 100) < 80;
    const colorPool = useVibrant ? VIBRANT_COLORS_COUNT : MONDAY_COLORS.length;
    
    const colorIndex = Math.floor((hash * goldenRatio % 1) * colorPool);
    
    // החשכה אוטומטית אם נדרש כדי להבטיח קריאות עם טקסט לבן
    return ensureDarkEnough(MONDAY_COLORS[colorIndex]);
};

/**
 * מפתח קבוע לצבע מותאם לדיווחים מסוג "שוטף" (לא לחיוב) במפת projectColors.
 * דיווחים אלה אינם משויכים לפרויקט, ולכן נדרש מזהה סינתטי.
 */
export const ROUTINE_COLOR_KEY = '__routine__';

/**
 * צבעים קבועים לסוגי אירועים יומיים
 * משתמש בצבעי Monday הרשמיים
 */
export const EVENT_TYPE_COLORS = {
    'חופשה': '#fdab3d',  // working_orange - כתום
    'מחלה': '#e2445c',   // stuck_red - אדום
    'מילואים': '#037f4c' // grass_green - ירוק כהה
};

/**
 * מחזיר צבע לאירוע לפי סוג האירוע או מזהה הפרויקט
 * אירועים יומיים (חופשה/מחלה/מילואים) - צבע לפי סוג האירוע
 * אירועים שעתיים - צבע לפי פרויקט (כדי להבדיל בין פרויקטים שונים)
 * @param {string} eventType - סוג האירוע (חופשה/מחלה/מילואים/שעתי)
 * @param {string} projectId - מזהה הפרויקט
 * @param {string} [eventTypeColor] - צבע הלייבל מ-Monday API (label_style.color)
 * @param {boolean} [isAllDay] - האם אירוע יומי
 * @param {string} [customColor] - צבע מותאם מהמיפוי projectColors (גובר על stringToColor לאירועים שעתיים)
 * @returns {string} - צבע בפורמט HSL או HEX
 */
export const getEventColor = (eventType, projectId, eventTypeColor, isAllDay, customColor) => {
    // אירועים יומיים - צבע לפי סוג האירוע (חופשה=כתום, מחלה=אדום וכו')
    if (isAllDay) {
        if (eventTypeColor) return ensureDarkEnough(eventTypeColor);
        if (eventType && EVENT_TYPE_COLORS[eventType]) return ensureDarkEnough(EVENT_TYPE_COLORS[eventType]);
    }

    // אירועים שעתיים - העדף צבע מותאם אישית מהמיפוי, אחרת hash דטרמיניסטי
    if (!isAllDay && customColor) {
        return ensureDarkEnough(customColor);
    }
    if (projectId) {
        return stringToColor(projectId.toString());
    }

    // fallback: צבע סוג אירוע אם אין פרויקט
    if (eventTypeColor) {
        return ensureDarkEnough(eventTypeColor);
    }

    // ברירת מחדל
    return ensureDarkEnough('#3174ad');
};
