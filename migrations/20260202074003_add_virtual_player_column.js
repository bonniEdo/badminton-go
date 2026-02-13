exports.up = function (knex) {
    return knex.schema.alterTable('GamePlayers', table => {
        table.boolean('IsVirtual').defaultTo(false);
        table.string('DisplayName', 100).nullable();
        table.dropUnique(['GameId', 'UserId']);
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