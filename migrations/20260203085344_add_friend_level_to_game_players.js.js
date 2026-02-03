exports.up = function (knex) {
    return knex.schema.table('GamePlayers', function (table) {
        table.integer('FriendLevel').nullable();
    });
};

exports.down = function (knex) {
    return knex.schema.table('GamePlayers', function (table) {
        table.dropColumn('FriendLevel');
    });
};