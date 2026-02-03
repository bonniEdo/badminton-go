exports.up = function (knex) {
    return knex.schema.alterTable('GamePlayers', table => {
        // 1. 新增標記欄位
        table.boolean('IsVirtual').defaultTo(false);
        table.string('DisplayName', 100).nullable();


        // 2. 重要：移除舊的唯一限制 (如果你以前有設定的話)
        // 注意：'gameplayers_gameid_userid_unique' 名稱可能因資料庫而異
        table.dropUnique(['GameId', 'UserId']);

        // 3. 建立新的唯一限制：允許 (GameId + UserId + IsVirtual) 組合唯一
        // 這樣 UserId 123 就可以有一筆 IsVirtual=false (本人) 和一筆 IsVirtual=true (朋友)
        table.unique(['GameId', 'UserId', 'IsVirtual']);
    });
};

exports.down = function (knex) {
    return knex.schema.alterTable('GamePlayers', table => {
        table.dropUnique(['GameId', 'UserId', 'IsVirtual']);
        table.unique(['GameId', 'UserId']);
        table.dropColumn('IsVirtual');
        table.dropColumn('DisplayName');
    });
};