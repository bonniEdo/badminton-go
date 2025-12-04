require('dotenv').config();

const knex = require('knex')({
    client: 'mssql',
    connection: {
        server: process.env.DB_SERVER,
        user: process.env.DB_USER,
        password: process.env.DB_PASSWORD,
        database: process.env.DB_NAME,
        options: {
            port: 1433,
            trustServerCertificate: true
        }
    },
});

knex.raw('SELECT 1')
    .then(() => {
        console.log('db connected successfully');
    })
    .catch((err) => {
        console.log('xxxxx db connection failed xxxxx', err);
    });



module.exports = knex;

