const express = require('express');
const authRoutes = require('./auth.routes');
const userRoutes = require('./user.routes');
const mushroomTypeRoutes = require('./mushroomType.routes');
const mushroomConditionRoutes = require('./mushroomCondition.routes');

const rootRouter = express.Router();

rootRouter.use('/auth', authRoutes);
rootRouter.use('/users', userRoutes);
rootRouter.use('/mushroom-types', mushroomTypeRoutes);
rootRouter.use('/mushroom-conditions', mushroomConditionRoutes);

module.exports = rootRouter;
