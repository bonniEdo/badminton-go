const parseLevel = (levelStr) => {
    if (!levelStr) return 1; // 預設最低等級
    // 使用正則表達式抓取字串中的第一個數字
    const match = levelStr.match(/\d+/);
    return match ? parseInt(match[0], 10) : 1;
};