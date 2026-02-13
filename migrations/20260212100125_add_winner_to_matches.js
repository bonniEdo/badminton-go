exports.up = function (knex) {
    return knex.schema.alterTable('Matches', function (table) {

        table.string('winner', 10).nullable();
    });
};

exports.down = function (knex) {
    return knex.schema.alterTable('Matches', function (table) {
        table.dropColumn('winner');
    });
};