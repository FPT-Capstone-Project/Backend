const express = require('express');
const authRoutes = require('./auth.routes');
const userRoutes = require('./user.routes');
const mushroomTypeRoutes = require('./mushroomType.routes');
const mushroomConditionRoutes = require('./mushroomCondition.routes');
const rentalPackageRoutes = require('./rentalPackage.routes');
const cultivationRoomRoutes = require('./cultivationRoom.routes');
const cultivationTrayRoutes = require('./cultivationTray.routes');
const orderRoutes = require('./order.routes');
const paymentRoutes = require('./payment.routes');
const rentalRoutes = require('./rental.routes');
const notificationRoutes = require('./notification.routes');

const rootRouter = express.Router();

rootRouter.use('/auth', authRoutes);
rootRouter.use('/users', userRoutes);
rootRouter.use('/mushroom-types', mushroomTypeRoutes);
rootRouter.use('/mushroom-conditions', mushroomConditionRoutes);
rootRouter.use('/rental-packages', rentalPackageRoutes);
rootRouter.use('/cultivation-rooms', cultivationRoomRoutes);
rootRouter.use('/cultivation-trays', cultivationTrayRoutes);
rootRouter.use('/orders', orderRoutes);
rootRouter.use('/rentals', rentalRoutes);
rootRouter.use('/payments', paymentRoutes);
rootRouter.use('/notifications', notificationRoutes);
rootRouter.use('/iot', require('./iot.routes'));
rootRouter.use('/cameras', require('./camera.routes'));

module.exports = rootRouter;
