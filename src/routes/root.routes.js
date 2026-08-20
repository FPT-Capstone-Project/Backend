const express = require('express');
const authRoutes = require('./auth.routes');
const userRoutes = require('./user.routes');

const rootRouter = express.Router();

rootRouter.use('/auth', authRoutes);
rootRouter.use('/users', userRoutes);

module.exports = rootRouter;
