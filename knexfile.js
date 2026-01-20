require('dotenv').config();

module.exports = {
    development: {
        client: 'pg',
        connection: {
            host: process.env.DB_SERVER,
            user: process.env.DB_USER,
            password: process.env.DB_PASSWORD,
            database: process.env.DB_NAME,
            port: 5432,
            ssl: {
                rejectUnauthorized: false
            }
        },
        pool: { min: 2, max: 10 },
        migrations: {
            directory: './migrations',
            tableName: 'knex_migrations'
        }
    }
}