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
        url: 'http://localhost:3000',
        description: 'Local development server',
      },
    ],
    tags: [
      { name: 'Health', description: 'Server health check' },
      { name: 'Authentication', description: 'Register, login and current user' },
      { name: 'Auth OTP', description: 'Email OTP registration and password flows' },
      { name: 'Users', description: 'Authenticated user resources' },
      { name: 'Mushroom Types', description: 'CRUD for mushroom types catalog' },
      { name: 'Mushroom Conditions', description: 'CRUD for mushroom growth conditions per mushroom type' },
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
          required: ['roleId', 'email', 'password', 'fullName'],
          properties: {
            roleId: { type: 'integer', example: 2 },
            email: { type: 'string', format: 'email', example: 'user@example.com' },
            password: { type: 'string', minLength: 8, example: 'password123' },
            fullName: { type: 'string', example: 'Nguyen Van A' },
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
            message: { type: 'string', example: 'Invalid email or password' },
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

module.exports = swaggerJSDoc(options);
