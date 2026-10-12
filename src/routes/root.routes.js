const express = require('express');
const authRoutes = require('./auth.routes');
const userRoutes = require('./user.routes');
const mushroomTypeRoutes = require('./mushroomType.routes');
const mushroomConditionRoutes = require('./mushroomCondition.routes');
const rentalPackageRoutes = require('./rentalPackage.routes');
const cultivationRoomRoutes = require('./cultivationRoom.routes');
const cultivationTrayRoutes = require('./cultivationTray.routes');

const rootRouter = express.Router();

rootRouter.use('/auth', authRoutes);
rootRouter.use('/users', userRoutes);
rootRouter.use('/mushroom-types', mushroomTypeRoutes);
rootRouter.use('/mushroom-conditions', mushroomConditionRoutes);
rootRouter.use('/rental-packages', rentalPackageRoutes);
rootRouter.use('/cultivation-rooms', cultivationRoomRoutes);
rootRouter.use('/cultivation-trays', cultivationTrayRoutes);

module.exports = rootRouter;
