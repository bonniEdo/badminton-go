const errorHandler = (err, req, res, next) => {
    console.error(err.stack);

    const statusCode = err.statusCode || 500;
    res.status(statusCode).json({
        status: 'error',
        message: err.message || '伺服器內部錯誤',
        stack: process.env.NODE_ENV === 'dev' ? err.stack : {}
    });
};

module.exports = errorHandler;