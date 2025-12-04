const { table } = require("../db");

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = function (knex) {
    return knex.schema.createTable('Users', function (table) {
        table.increments('Id').primary();
        table.string('Username', 50).notNullable();
        table.string('Email', 100).unique().notNullable();
        table.string('Password', 255).notNullable();
        table.datetime('CreateAt').defaultTo(knex.fn.now());

    })
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = function (knex) {
    return knex.schema.dropTable('Users');
};
