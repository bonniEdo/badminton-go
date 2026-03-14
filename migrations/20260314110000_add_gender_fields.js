/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function (knex) {
    const hasUsersGender = await knex.schema.hasColumn('Users', 'Gender');
    if (!hasUsersGender) {
        await knex.schema.alterTable('Users', function (table) {
            table.string('Gender', 20).notNullable().defaultTo('undisclosed');
        });
    }

    const hasFriendGender = await knex.schema.hasColumn('GamePlayers', 'FriendGender');
    if (!hasFriendGender) {
        await knex.schema.alterTable('GamePlayers', function (table) {
            table.string('FriendGender', 20).nullable();
        });
    }
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function (knex) {
    const hasFriendGender = await knex.schema.hasColumn('GamePlayers', 'FriendGender');
    if (hasFriendGender) {
        await knex.schema.alterTable('GamePlayers', function (table) {
            table.dropColumn('FriendGender');
        });
    }

    const hasUsersGender = await knex.schema.hasColumn('Users', 'Gender');
    if (hasUsersGender) {
        await knex.schema.alterTable('Users', function (table) {
            table.dropColumn('Gender');
        });
    }
};
