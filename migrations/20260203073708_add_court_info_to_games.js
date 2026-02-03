exports.up = function (knex) {
    return knex.schema.table('Games', function (table) {
        table.string('CourtNumber', 50).nullable();
        table.integer('CourtCount').defaultTo(1);
    });
};

exports.down = function (knex) {
    return knex.schema.table('Games', function (table) {
        table.dropColumn('CourtNumber');
        table.dropColumn('CourtCount');
    });
};