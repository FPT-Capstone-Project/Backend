const swaggerJSDoc = require('swagger-jsdoc');

const options = {
  definition: {
    openapi: '3.0.3',
    info: {
      title: 'Capstone Backend API',
      version: '1.0.0',
      description: 'Authentication and user API using JWT.',
    },
    servers: [
      {
        url: process.env.SERVER_URL || '/',
        description: 'API server',
      },
    ],
    tags: [
      { name: 'Health', description: 'Server health check' },
      { name: 'Authentication', description: 'Register, login and current user' },
      { name: 'Auth OTP', description: 'Email OTP registration and password flows' },
      { name: 'Users', description: 'Authenticated user resources' },
      { name: 'Mushroom Types', description: 'CRUD for mushroom types catalog' },
      { name: 'Mushroom Conditions', description: 'CRUD for mushroom growth conditions per mushroom type' },
      { name: 'Rental Packages', description: 'CRUD for rental packages' },
      { name: 'Cultivation Rooms', description: 'Manage cultivation rooms' },
      { name: 'Cultivation Trays', description: 'Manage cultivation trays' },
      { name: 'Orders', description: 'Customer orders for rental packages and mushroom types' },
      { name: 'Rentals', description: 'Rental records created after successful payment and managed by Admin/Farm Operator' },
      { name: 'Payments', description: 'PayOS checkout payments for customer orders' },
    ],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
        },
      },
      schemas: {
        RegisterRequest: {
          type: 'object',
          required: ['email', 'password', 'fullName'],
          properties: {
            email: { type: 'string', format: 'email', example: 'user@example.com' },
            password: { type: 'string', minLength: 8, example: 'password123' },
            fullName: { type: 'string', example: 'Nguyen Van A' },
            name: { type: 'string', description: 'Alias for fullName' },
            roleId: {
              type: 'integer',
              minimum: 1,
              example: 3,
              description: 'Optional; role IDs in the current seed: 1 = Farm Operator, 2 = Admin, 3 = Customer. Without roleId, Customer (3) is assigned.',
            },
            phone: { type: 'string', example: '0900000000' },
            address: { type: 'string', example: 'Ho Chi Minh City' },
          },
        },
        LoginRequest: {
          type: 'object',
          required: ['email', 'password'],
          properties: {
            email: { type: 'string', format: 'email', example: 'user@example.com' },
            password: { type: 'string', example: 'password123' },
          },
        },
        User: {
          type: 'object',
          properties: {
            user_id: { type: 'integer', example: 1 },
            role_id: { type: 'integer', example: 2 },
            email: { type: 'string', format: 'email', example: 'user@example.com' },
            full_name: { type: 'string', example: 'Nguyen Van A' },
            phone: { type: 'string', nullable: true, example: '0900000000' },
            address: { type: 'string', nullable: true, example: 'Ho Chi Minh City' },
            status: { type: 'string', example: 'ACTIVE' },
            created_at: { type: 'string', format: 'date-time' },
            updated_at: { type: 'string', format: 'date-time' },
          },
        },
        UserWithRole: {
          type: 'object',
          properties: {
            user_id: { type: 'integer', example: 1 },
            role_id: { type: 'integer', example: 3 },
            role_name: { type: 'string', example: 'Customer' },
            role_description: { type: 'string', nullable: true },
            email: { type: 'string', format: 'email', example: 'user@example.com' },
            full_name: { type: 'string', example: 'Nguyen Van A' },
            phone: { type: 'string', nullable: true, example: '0900000000' },
            address: { type: 'string', nullable: true, example: 'Ho Chi Minh City' },
            status: { type: 'string', enum: ['ACTIVE', 'INACTIVE', 'BLOCKED'], example: 'ACTIVE' },
            created_at: { type: 'string', format: 'date-time' },
            updated_at: { type: 'string', format: 'date-time' },
          },
        },
        UserAccountDetail: {
          allOf: [
            { $ref: '#/components/schemas/UserWithRole' },
            {
              type: 'object',
              properties: {
                order_count: { type: 'integer', minimum: 0, example: 12 },
                rental_count: { type: 'integer', minimum: 0, example: 4 },
              },
            },
          ],
        },
        CreateManagedUserRequest: {
          type: 'object',
          required: ['email', 'password', 'fullName', 'roleId'],
          properties: {
            email: { type: 'string', format: 'email', example: 'staff@example.com' },
            password: { type: 'string', minLength: 8, example: 'password123' },
            fullName: { type: 'string', example: 'Nguyen Van A' },
            roleId: { type: 'integer', minimum: 1, example: 2 },
            phone: { type: 'string', example: '0900000000' },
            address: { type: 'string', example: 'Ho Chi Minh City' },
          },
        },
        UpdateUserStatusRequest: {
          type: 'object',
          required: ['status'],
          properties: {
            status: { type: 'string', enum: ['ACTIVE', 'INACTIVE', 'BLOCKED'], example: 'BLOCKED' },
          },
        },
        MushroomType: {
          type: 'object',
          properties: {
            mushroom_type_id: { type: 'integer', example: 1 },
            name: { type: 'string', example: 'King Oyster' },
            description: { type: 'string', nullable: true, example: 'Mushroom type for soups and hotpot' },
            growing_days: { type: 'integer', example: 25 },
            price: { type: 'number', format: 'double', example: 120000 },
            image_url: { type: 'string', nullable: true, example: 'https://example.com/image.jpg' },
            status: { type: 'string', enum: ['ACTIVE', 'INACTIVE'], example: 'ACTIVE' },
            created_at: { type: 'string', format: 'date-time' },
          },
        },
        CreateMushroomTypeRequest: {
          type: 'object',
          required: ['name', 'growingDays', 'price'],
          properties: {
            name: { type: 'string', example: 'King Oyster' },
            description: { type: 'string', example: 'Mushroom type for soups and hotpot' },
            growingDays: { type: 'integer', example: 25 },
            price: { type: 'number', example: 120000 },
            imageUrl: { type: 'string', example: 'https://example.com/image.jpg' },
            status: { type: 'string', enum: ['ACTIVE', 'INACTIVE'], example: 'ACTIVE' },
          },
        },
        UpdateMushroomTypeRequest: {
          type: 'object',
          properties: {
            name: { type: 'string', example: 'King Oyster Premium' },
            description: { type: 'string', example: 'Updated description' },
            growingDays: { type: 'integer', example: 30 },
            price: { type: 'number', example: 150000 },
            imageUrl: { type: 'string', example: 'https://example.com/new-image.jpg' },
            status: { type: 'string', enum: ['ACTIVE', 'INACTIVE'], example: 'INACTIVE' },
          },
        },
        RentalPackage: {
          type: 'object',
          properties: {
            package_id: { type: 'integer', example: 1 },
            package_name: { type: 'string', example: 'Standard 30-day package' },
            description: { type: 'string', nullable: true, example: 'Includes one cultivation tray' },
            duration_days: { type: 'integer', example: 30 },
            price: { type: 'number', format: 'double', example: 500000 },
            status: { type: 'string', enum: ['ACTIVE', 'INACTIVE'], example: 'ACTIVE' },
          },
        },
        CreateRentalPackageRequest: {
          type: 'object',
          required: ['packageName', 'durationDays', 'price'],
          properties: {
            packageName: { type: 'string', example: 'Standard 30-day package' },
            description: { type: 'string', example: 'Includes one cultivation tray' },
            durationDays: { type: 'integer', example: 30 },
            price: { type: 'number', example: 500000 },
            status: { type: 'string', enum: ['ACTIVE', 'INACTIVE'], example: 'ACTIVE' },
          },
        },
        UpdateRentalPackageRequest: {
          type: 'object',
          properties: {
            packageName: { type: 'string', example: 'Premium 30-day package' },
            description: { type: 'string', example: 'Updated package details' },
            durationDays: { type: 'integer', example: 30 },
            price: { type: 'number', example: 550000 },
            status: { type: 'string', enum: ['ACTIVE', 'INACTIVE'], example: 'INACTIVE' },
          },
        },
        CreateRentalOrderRequest: {
          type: 'object',
          required: ['mushroomTypeId'],
          properties: {
            packageId: {
              type: 'integer',
              nullable: true,
              example: 1,
              description: 'Optional rental package ID. When provided, the order has one RENTAL item containing both this package and mushroomTypeId.',
            },
            mushroomTypeId: {
              type: 'integer',
              example: 2,
              description: 'Required mushroom type ID. Without packageId, creates one MUSHROOM order item.',
            },
          },
        },
        PayosPaymentResponse: {
          type: 'object',
          required: ['success', 'message', 'data'],
          properties: {
            success: { type: 'boolean', example: true },
            message: { type: 'string', example: 'PayOS payment created successfully' },
            data: {
              type: 'object',
              required: ['paymentId', 'orderCode', 'orderId', 'amount', 'checkoutUrl', 'expiresAt', 'paymentStatus'],
              properties: {
                paymentId: { type: 'integer', example: 34 },
                orderCode: { type: 'integer', example: 34, description: 'PayOS order code' },
                orderId: { type: 'integer', example: 12 },
                amount: { type: 'integer', example: 530000 },
                checkoutUrl: { type: 'string', format: 'uri', example: 'https://pay.payos.vn/web/abc123' },
                qrCode: { type: 'string', nullable: true, example: '000201010212...' },
                expiresAt: { type: 'integer', format: 'int64', example: 1735689600, description: 'Unix timestamp in seconds' },
                paymentStatus: {
                  type: 'string',
                  enum: ['PENDING', 'PAID', 'FAILED', 'REFUNDED', 'CANCELLED'],
                  example: 'PENDING',
                },
              },
            },
          },
        },
        PaymentStatusResponse: {
          type: 'object',
          required: ['success', 'data'],
          properties: {
            success: { type: 'boolean', example: true },
            data: {
              type: 'object',
              required: ['orderId', 'orderStatus', 'paymentStatus', 'paymentCode', 'amount'],
              properties: {
                orderId: { type: 'integer', example: 12 },
                orderStatus: {
                  type: 'string',
                  enum: ['PENDING', 'CONFIRMED', 'PROCESSING', 'COMPLETED', 'CANCELLED'],
                  description: 'Becomes CONFIRMED after a successful PayOS payment.',
                  example: 'PENDING',
                },
                paymentStatus: {
                  type: 'string',
                  enum: ['UNPAID', 'PENDING', 'PAID', 'FAILED', 'REFUND_PENDING', 'REFUNDED'],
                  example: 'PENDING',
                },
                paymentCode: { type: 'string', example: '34', description: 'PayOS order code for the latest payment' },
                amount: { type: 'number', example: 530000 },
              },
            },
          },
        },
        CultivationRoom: {
          type: 'object',
          properties: {
            room_id: { type: 'integer', example: 1 },
            room_code: { type: 'string', example: 'ROOM-01' },
            room_name: { type: 'string', example: 'Growing room 1' },
            description: { type: 'string', nullable: true, example: 'Main cultivation room' },
            capacity: { type: 'integer', example: 20 },
            status: { type: 'string', enum: ['ACTIVE', 'INACTIVE', 'MAINTENANCE'], example: 'ACTIVE' },
            created_at: { type: 'string', format: 'date-time' },
            updated_at: { type: 'string', format: 'date-time' },
          },
        },
        CreateCultivationRoomRequest: {
          type: 'object',
          required: ['roomCode', 'roomName'],
          properties: {
            roomCode: { type: 'string', example: 'ROOM-01' },
            roomName: { type: 'string', example: 'Growing room 1' },
            description: { type: 'string', example: 'Main cultivation room' },
            capacity: { type: 'integer', example: 20 },
            status: { type: 'string', enum: ['ACTIVE', 'INACTIVE', 'MAINTENANCE'], example: 'ACTIVE' },
          },
        },
        UpdateCultivationRoomRequest: {
          type: 'object',
          properties: {
            roomCode: { type: 'string', example: 'ROOM-01' },
            roomName: { type: 'string', example: 'Growing room 1' },
            description: { type: 'string', nullable: true },
            capacity: { type: 'integer', example: 24 },
            status: { type: 'string', enum: ['ACTIVE', 'INACTIVE', 'MAINTENANCE'] },
          },
        },
        CultivationTray: {
          type: 'object',
          properties: {
            tray_id: { type: 'integer', example: 1 },
            room_id: { type: 'integer', example: 1 },
            room_code: { type: 'string', example: 'ROOM-01' },
            room_name: { type: 'string', example: 'Growing room 1' },
            floor_id: { type: 'integer', nullable: true, example: 1 },
            floor_number: { type: 'integer', nullable: true, example: 1 },
            floor_name: { type: 'string', nullable: true, example: 'Floor 1' },
            tray_code: { type: 'string', example: 'TRAY-01' },
            tray_name: { type: 'string', nullable: true, example: 'Rack A, level 1' },
            status: { type: 'string', enum: ['AVAILABLE', 'OCCUPIED', 'MAINTENANCE', 'INACTIVE'], example: 'AVAILABLE' },
            created_at: { type: 'string', format: 'date-time' },
            updated_at: { type: 'string', format: 'date-time' },
          },
        },
        CreateCultivationTrayRequest: {
          type: 'object',
          required: ['roomId', 'trayCode'],
          properties: {
            roomId: { type: 'integer', example: 1 },
            floorId: { type: 'integer', nullable: true, example: 1, description: 'Optional floor within the selected room. Trays without a floor cannot start cultivation.' },
            trayCode: { type: 'string', example: 'TRAY-01' },
            trayName: { type: 'string', example: 'Rack A, level 1' },
            status: { type: 'string', enum: ['AVAILABLE', 'OCCUPIED', 'MAINTENANCE', 'INACTIVE'], example: 'AVAILABLE' },
          },
        },
        UpdateCultivationTrayRequest: {
          type: 'object',
          properties: {
            roomId: { type: 'integer', example: 1 },
            floorId: { type: 'integer', nullable: true, example: 1, description: 'Assign a floor in the selected room, or null to unassign it.' },
            trayCode: { type: 'string', example: 'TRAY-01' },
            trayName: { type: 'string', nullable: true },
            status: { type: 'string', enum: ['AVAILABLE', 'OCCUPIED', 'MAINTENANCE', 'INACTIVE'] },
          },
        },
        MushroomCondition: {
          type: 'object',
          properties: {
            condition_id: { type: 'integer', example: 1 },
            mushroom_type_id: { type: 'integer', example: 1 },
            temperature_min: { type: 'number', nullable: true, example: 18 },
            temperature_max: { type: 'number', nullable: true, example: 24 },
            humidity_min: { type: 'number', nullable: true, example: 80 },
            humidity_max: { type: 'number', nullable: true, example: 90 },
            co2_min: { type: 'number', nullable: true, example: 350 },
            co2_max: { type: 'number', nullable: true, example: 500 },
            substrate_moisture_min: { type: 'number', nullable: true, example: 55 },
            substrate_moisture_max: { type: 'number', nullable: true, example: 70 },
            created_at: { type: 'string', format: 'date-time' },
            updated_at: { type: 'string', format: 'date-time' },
          },
        },
        CreateMushroomConditionRequest: {
          type: 'object',
          required: ['mushroomTypeId'],
          properties: {
            mushroomTypeId: { type: 'integer', example: 1 },
            temperatureMin: { type: 'number', nullable: true, example: 18 },
            temperatureMax: { type: 'number', nullable: true, example: 24 },
            humidityMin: { type: 'number', nullable: true, example: 80 },
            humidityMax: { type: 'number', nullable: true, example: 90 },
            co2Min: { type: 'number', nullable: true, example: 350 },
            co2Max: { type: 'number', nullable: true, example: 500 },
            substrateMoistureMin: { type: 'number', nullable: true, example: 55 },
            substrateMoistureMax: { type: 'number', nullable: true, example: 70 },
          },
        },
        UpdateMushroomConditionRequest: {
          type: 'object',
          properties: {
            mushroomTypeId: { type: 'integer', example: 1 },
            temperatureMin: { type: 'number', nullable: true, example: 17 },
            temperatureMax: { type: 'number', nullable: true, example: 25 },
            humidityMin: { type: 'number', nullable: true, example: 75 },
            humidityMax: { type: 'number', nullable: true, example: 88 },
            co2Min: { type: 'number', nullable: true, example: 300 },
            co2Max: { type: 'number', nullable: true, example: 600 },
            substrateMoistureMin: { type: 'number', nullable: true, example: 50 },
            substrateMoistureMax: { type: 'number', nullable: true, example: 68 },
          },
        },
        AuthResponse: {
          type: 'object',
          properties: {
            message: { type: 'string', example: 'Login successful' },
            token: { type: 'string', example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...' },
            user: { $ref: '#/components/schemas/User' },
          },
        },
        Error: {
          type: 'object',
          properties: {
            message: {
              type: 'string',
              example: 'Nấm này đã có condition rồi',
              description: 'Business validation error. Each mushroom type can only have one condition.',
            },
          },
        },
      },
    },
    paths: {
      '/health': {
        get: {
          tags: ['Health'],
          summary: 'Check API health',
          responses: {
            200: {
              description: 'API is healthy',
              content: { 'application/json': { schema: { type: 'object', properties: { status: { type: 'string', example: 'ok' } } } } },
            },
          },
        },
      },
    },
  },
  apis: ['src/routes/*.js'],
};

const specification = swaggerJSDoc(options);
const iot = require('./iot-swagger');
Object.assign(specification.components.schemas, iot.schemas);
Object.assign(specification.paths, iot.paths);
specification.tags.push({ name: 'IoT', description: 'SmartMush telemetry and manual SSR commands' });
module.exports = specification;
const autoMisting = require('./autoMisting-swagger');
Object.assign(specification.components.schemas, autoMisting.schemas);
Object.assign(specification.paths, autoMisting.paths);
specification.tags.push({ name: 'Automatic misting', description: 'Explicit per-floor Save, Start and Stop control' });
