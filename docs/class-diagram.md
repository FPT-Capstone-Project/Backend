# Class Diagram - Mushroom Farm Backend

Sơ đồ được dựng từ schema PostgreSQL trong `database.sql`, các migrations và module backend hiện tại. `User` dùng `Role` để phân biệt Admin, Farm Operator và Customer; không có các lớp con riêng cho từng vai trò.

## 0. Cấu trúc module backend

Sơ đồ dưới đây bao gồm **toàn bộ router hiện có**: 13 router nghiệp vụ được đăng ký trong `root.routes.js`, router tài liệu Swagger được gắn trực tiếp trong `app.js`, cùng root router. Nó nối từng router với controller, service và model tương ứng; `AutoMistingController` được truy cập qua `iot.routes.js`. Trong Express/CommonJS, đây là các module JavaScript export router/function/object, không phải các lớp khai báo bằng từ khóa `class`; stereotype `<<module>>` phản ánh đúng cấu trúc code. Một số model/service được dùng chung giữa nhiều luồng.

```mermaid
classDiagram
    direction LR

    class RootRouter {
        <<module>>
        +mountFeatureRoutes()
    }
    class SwaggerRouter {
        <<module>>
        +serveApiDocs()
        +serveOpenApiJson()
    }

    class AuthRoutes {
        <<module>>
        +register()
        +login()
        +getCurrentUser()
        +registerOtp()
        +verifyRegistrationOtp()
        +forgotPassword()
        +resetPasswordOtp()
        +changePasswordOtp()
    }
    class UserRoutes {
        <<module>>
        +getCurrentUser()
        +listUsers()
        +createUser()
        +getUserById()
        +updateUserStatus()
    }
    class MushroomTypeRoutes {
        <<module>>
        +list()
        +getById()
        +create()
        +update()
        +remove()
    }
    class MushroomConditionRoutes {
        <<module>>
        +list()
        +getById()
        +create()
        +update()
        +remove()
    }
    class RentalPackageRoutes {
        <<module>>
        +list()
        +getById()
        +create()
        +update()
        +remove()
    }
    class CultivationRoomRoutes {
        <<module>>
        +list()
        +getById()
        +listRoomTrays()
        +create()
        +update()
        +remove()
    }
    class CultivationTrayRoutes {
        <<module>>
        +list()
        +getById()
        +create()
        +update()
        +remove()
    }
    class OrderRoutes {
        <<module>>
        +list()
        +getById()
        +createRentalOrder()
        +cancel()
    }
    class RentalRoutes {
        <<module>>
        +adminList()
        +adminCreateFromOrder()
        +startCultivation()
        +createProgress()
        +createHarvest()
        +completeRental()
        +cancelRental()
        +adminUpdate()
    }
    class PaymentRoutes {
        <<module>>
        +createPayosPayment()
        +getPaymentStatus()
        +payosWebhook()
    }
    class NotificationRoutes {
        <<module>>
        +list()
        +markRead()
        +markAllRead()
    }
    class IoTRoutes {
        <<module>>
        +listMasters()
        +getSensorReadings()
        +getSensorHistory()
        +controlSsr()
        +manageFloorAutomation()
    }
    class CameraRoutes {
        <<module>>
        +listCameras()
        +createCamera()
        +updateCamera()
        +deleteCamera()
        +getLiveStreams()
        +stopLiveStream()
    }

    class AuthController {
        <<module>>
        +register(req, res)
        +login(req, res)
        +me(req, res)
        +registerOtp(req, res)
        +verifyRegistrationOtp(req, res)
        +forgotPassword(req, res)
        +resetPasswordOtp(req, res)
    }
    class UserController {
        <<module>>
        +list(req, res)
        +getById(req, res)
        +create(req, res)
        +updateStatus(req, res)
    }
    class MushroomTypeController {
        <<module>>
        +list(req, res)
        +getById(req, res)
        +create(req, res)
        +update(req, res)
        +remove(req, res)
    }
    class MushroomConditionController {
        <<module>>
        +list(req, res)
        +getById(req, res)
        +create(req, res)
        +update(req, res)
        +remove(req, res)
    }
    class RentalPackageController {
        <<module>>
        +list(req, res)
        +getById(req, res)
        +create(req, res)
        +update(req, res)
        +remove(req, res)
    }
    class CultivationRoomController {
        <<module>>
        +list(req, res)
        +getById(req, res)
        +create(req, res)
        +update(req, res)
        +remove(req, res)
    }
    class CultivationTrayController {
        <<module>>
        +list(req, res)
        +listByRoom(req, res)
        +getById(req, res)
        +create(req, res)
        +update(req, res)
        +remove(req, res)
    }
    class OrderController {
        <<module>>
        +list(req, res)
        +getById(req, res)
        +create(req, res)
        +cancel(req, res)
    }
    class RentalController {
        <<module>>
        +adminList(req, res)
        +adminGetById(req, res)
        +adminCreateFromOrder(req, res)
        +adminCreateProgress(req, res)
        +adminCreateHarvest(req, res)
        +adminComplete(req, res)
        +adminCancel(req, res)
        +adminUpdate(req, res)
    }
    class PaymentController {
        <<module>>
        +createPayosPayment(req, res)
        +getPayosPaymentStatus(req, res)
        +payosWebhook(req, res)
    }
    class NotificationController {
        <<module>>
        +list(req, res)
        +markRead(req, res)
        +markAllRead(req, res)
    }
    class IoTController {
        <<module>>
        +list(req, res)
        +sensors(req, res)
        +history(req, res)
        +control(req, res)
    }
    class AutoMistingController {
        <<module>>
        +list(req, res)
        +environment(req, res)
        +configuration(req, res)
        +save(req, res)
        +start(req, res)
        +stop(req, res)
        +logs(req, res)
    }
    class CameraController {
        <<module>>
        +list(req, res)
        +getById(req, res)
        +create(req, res)
        +update(req, res)
        +remove(req, res)
        +listLiveStreams(req, res)
        +stopLiveSession(req, res)
    }

    class AuthService {
        <<module>>
        +register()
        +login()
        +registerOtp()
        +verifyRegistrationOtp()
        +forgotPassword()
        +resetPasswordOtp()
    }
    class UserService {
        <<module>>
        +getUsers()
        +getUserDetail()
        +createUser()
        +updateUserStatus()
    }
    class MushroomTypeService {
        <<module>>
        +getAllMushroomTypes()
        +getMushroomTypeById()
        +createMushroomType()
        +updateMushroomType()
        +deleteMushroomType()
    }
    class MushroomConditionService {
        <<module>>
        +getAllMushroomConditions()
        +getMushroomConditionById()
        +createMushroomCondition()
        +updateMushroomCondition()
        +deleteMushroomCondition()
    }
    class RentalPackageService {
        <<module>>
        +getAllRentalPackages()
        +getRentalPackageById()
        +createRentalPackage()
        +updateRentalPackage()
        +deleteRentalPackage()
    }
    class CultivationRoomService {
        <<module>>
        +getAllCultivationRooms()
        +getCultivationRoomById()
        +createCultivationRoom()
        +updateCultivationRoom()
        +deleteCultivationRoom()
    }
    class CultivationTrayService {
        <<module>>
        +getAllCultivationTrays()
        +getCultivationTraysByRoomId()
        +getCultivationTrayById()
        +createCultivationTray()
        +updateCultivationTray()
        +deleteCultivationTray()
    }
    class OrderService {
        <<module>>
        +createRentalOrder()
        +getCustomerOrders()
        +getCustomerOrderDetails()
        +cancelCustomerOrder()
    }
    class RentalService {
        <<module>>
        +getAllRentalsForAdmin()
        +getRentalByIdForAdmin()
        +createRentalFromOrderForAdmin()
        +createProgressForAdmin()
        +createHarvestForAdmin()
        +completeRentalForAdmin()
        +cancelRentalForAdmin()
    }
    class PaymentService {
        <<module>>
        +createPayosPayment()
        +getPayosPaymentStatus()
        +handlePayosWebhook()
    }
    class NotificationService {
        <<module>>
        +sendRentalNotification()
        +getNotifications()
        +markNotificationAsRead()
        +markAllNotificationsAsRead()
    }
    class IoTService {
        <<module>>
        +listMasters()
        +sensors()
        +sensor()
        +history()
        +ssr()
        +control()
    }
    class AutoMistingService {
        <<module>>
        +list()
        +environment()
        +configuration()
        +save()
        +start()
        +stop()
        +status()
        +logs()
        +evaluate()
    }
    class CameraService {
        <<module>>
        +getAllCameras()
        +getCameraById()
        +createCamera()
        +updateCamera()
        +deleteCamera()
        +getLiveStreams()
        +stopLiveStream()
    }

    class UserModel {
        <<module>>
        +findByEmail()
        +findById()
        +create()
        +findAllWithRole()
        +updateStatusById()
        +saveOtp()
        +markEmailVerified()
    }
    class MushroomTypeModel {
        <<module>>
        +findAll()
        +findById()
        +findByName()
        +create()
        +updateById()
        +removeById()
    }
    class MushroomConditionModel {
        <<module>>
        +findAll()
        +findById()
        +findByMushroomTypeId()
        +create()
        +updateById()
        +removeById()
    }
    class RentalPackageModel {
        <<module>>
        +findAll()
        +findById()
        +create()
        +updateById()
        +removeById()
    }
    class CultivationRoomModel {
        <<module>>
        +findAll()
        +findById()
        +create()
        +updateById()
        +removeById()
    }
    class CultivationTrayModel {
        <<module>>
        +findAll()
        +findById()
        +findFloorById()
        +create()
        +updateById()
        +removeById()
    }
    class OrderModel {
        <<module>>
        +findAllByUserId()
        +findByIdForUser()
        +createRentalOrder()
        +cancelOrderForUser()
    }
    class RentalModel {
        <<module>>
        +findAllForAdmin()
        +findByIdForAdmin()
        +createFromOrderForAdmin()
        +createProgressForAdmin()
        +createHarvestForAdmin()
        +completeForAdmin()
        +cancelForAdmin()
    }
    class PaymentModel {
        <<module>>
        +createOrGetPayosPayment()
        +savePayosPaymentLink()
        +markPayosPaymentAsPaid()
        +markPayosPaymentFailed()
        +findPayosPaymentStatus()
    }
    class NotificationModel {
        <<module>>
        +findRentalRecipient()
        +createForRental()
        +findAllByUserId()
        +markAsReadById()
        +markAllAsReadByUserId()
    }
    class IoTModel {
        <<module>>
        +findMasters()
        +findSensors()
        +findSensor()
        +history()
        +findSsr()
        +createCommand()
    }
    class AutoMistingModel {
        <<module>>
        +floor()
        +saveConfig()
        +createRun()
        +endRun()
        +runtimeSet()
        +log()
    }
    class CameraModel {
        <<module>>
        +findAll()
        +findById()
        +create()
        +updateById()
        +removeById()
    }

    class PostgreSQL {
        <<external>>
    }
    class PayOS {
        <<external>>
    }
    class MQTTBroker {
        <<external>>
    }
    class SwaggerSpec {
        <<config>>
    }

    RootRouter --> AuthRoutes : /auth
    RootRouter --> UserRoutes : /users
    RootRouter --> MushroomTypeRoutes : /mushroom-types
    RootRouter --> MushroomConditionRoutes : /mushroom-conditions
    RootRouter --> RentalPackageRoutes : /rental-packages
    RootRouter --> CultivationRoomRoutes : /cultivation-rooms
    RootRouter --> CultivationTrayRoutes : /cultivation-trays
    RootRouter --> OrderRoutes : /orders
    RootRouter --> RentalRoutes : /rentals
    RootRouter --> PaymentRoutes : /payments
    RootRouter --> NotificationRoutes : /notifications
    RootRouter --> IoTRoutes : /iot
    RootRouter --> CameraRoutes : /cameras

    AuthRoutes --> AuthController
    UserRoutes --> AuthController : current user
    UserRoutes --> UserController
    MushroomTypeRoutes --> MushroomTypeController
    MushroomConditionRoutes --> MushroomConditionController
    RentalPackageRoutes --> RentalPackageController
    CultivationRoomRoutes --> CultivationRoomController
    CultivationRoomRoutes --> CultivationTrayController : room trays
    CultivationTrayRoutes --> CultivationTrayController
    OrderRoutes --> OrderController
    RentalRoutes --> RentalController
    PaymentRoutes --> PaymentController
    NotificationRoutes --> NotificationController
    IoTRoutes --> IoTController : sensors and devices
    IoTRoutes --> AutoMistingController : floor automation
    CameraRoutes --> CameraController

    AuthController --> AuthService
    UserController --> UserService
    MushroomTypeController --> MushroomTypeService
    MushroomConditionController --> MushroomConditionService
    RentalPackageController --> RentalPackageService
    CultivationRoomController --> CultivationRoomService
    CultivationTrayController --> CultivationTrayService
    OrderController --> OrderService
    RentalController --> RentalService
    RentalController --> NotificationService : harvest notifications
    PaymentController --> PaymentService
    NotificationController --> NotificationService
    IoTController --> IoTService
    AutoMistingController --> AutoMistingService
    CameraController --> CameraService

    AuthService --> UserModel
    UserService --> UserModel
    MushroomTypeService --> MushroomTypeModel
    MushroomConditionService --> MushroomConditionModel
    MushroomConditionService --> MushroomTypeModel
    RentalPackageService --> RentalPackageModel
    CultivationRoomService --> CultivationRoomModel
    CultivationTrayService --> CultivationTrayModel
    CultivationTrayService --> CultivationRoomModel
    OrderService --> OrderModel
    RentalService --> RentalModel
    PaymentService --> PaymentModel
    NotificationService --> NotificationModel
    IoTService --> IoTModel
    IoTService --> AutoMistingModel : shared command locks
    AutoMistingService --> AutoMistingModel
    CameraService --> CameraModel

    UserModel --> PostgreSQL
    MushroomTypeModel --> PostgreSQL
    MushroomConditionModel --> PostgreSQL
    RentalPackageModel --> PostgreSQL
    CultivationRoomModel --> PostgreSQL
    CultivationTrayModel --> PostgreSQL
    OrderModel --> PostgreSQL
    RentalModel --> PostgreSQL
    PaymentModel --> PostgreSQL
    NotificationModel --> PostgreSQL
    IoTModel --> PostgreSQL
    AutoMistingModel --> PostgreSQL
    CameraModel --> PostgreSQL
    PaymentService --> PayOS : payment links and webhooks
    IoTService --> MQTTBroker : device commands
    AutoMistingService --> MQTTBroker : automation commands
    SwaggerRouter --> SwaggerSpec : API documentation
```

`swagger.routes.js` không thuộc `root.routes.js`: `app.js` gắn trực tiếp router này để phục vụ `/api-docs` và `/api-docs.json`.

## 1. Nghiệp vụ người dùng, đơn hàng và trồng nấm

```mermaid
classDiagram
    direction LR

    class User {
        +int user_id
        +int role_id
        +string email
        +string password_hash
        +string full_name
        +string phone
        +string address
        +string status
        +bool is_email_verified
        +string otp_code
        +string otp_type
        +datetime otp_expires_at
    }
    class Role {
        +int role_id
        +string role_name
        +string description
    }
    class Permission {
        +int permission_id
        +string permission_name
        +string description
    }
    class RolePermission {
        +int role_id
        +int permission_id
    }
    class RentalPackage {
        +int package_id
        +string package_name
        +int duration_days
        +decimal price
        +string status
    }
    class MushroomType {
        +int mushroom_type_id
        +string name
        +int growing_days
        +decimal price
        +string status
    }
    class MushroomCondition {
        +int condition_id
        +decimal temperature_min
        +decimal temperature_max
        +decimal humidity_min
        +decimal humidity_max
        +decimal co2_min
        +decimal co2_max
    }
    class Order {
        +int order_id
        +int user_id
        +decimal total_amount
        +string status
        +string payment_status
        +datetime created_at
    }
    class OrderItem {
        +int order_item_id
        +int order_id
        +string item_type
        +int rental_package_id
        +int mushroom_type_id
        +int quantity
        +decimal unit_price
        +decimal total_price
    }
    class Payment {
        +int payment_id
        +int order_id
        +decimal amount
        +string payment_method
        +string transaction_code
        +string status
        +datetime paid_at
    }
    class Shipment {
        +int shipment_id
        +int order_id
        +string address
        +string recipient_name
        +string recipient_phone
        +string tracking_code
        +string status
    }
    class Rental {
        +int rental_id
        +int order_id
        +int user_id
        +int tray_id
        +int duration_days
        +datetime start_date
        +datetime end_date
        +string status
    }
    class CultivationRoom {
        +int room_id
        +string room_code
        +string room_name
        +int capacity
        +string status
    }
    class CultivationFloor {
        +int floor_id
        +int room_id
        +int floor_number
        +string floor_name
        +int master_id
        +int node_address
        +int misting_ssr_channel
        +string status
    }
    class CultivationTray {
        +int tray_id
        +int room_id
        +int floor_id
        +string tray_code
        +string status
    }
    class CultivationSession {
        +int session_id
        +int rental_id
        +int tray_id
        +int mushroom_type_id
        +datetime start_at
        +datetime end_at
        +string status
        +date harvest_date
    }
    class CultivationProgress {
        +int progress_id
        +int session_id
        +string current_stage
        +decimal progress_percent
        +date expected_harvest_date
        +string description
    }
    class Harvest {
        +int harvest_id
        +int session_id
        +date harvest_date
        +decimal quantity
        +string unit
        +string quality_grade
    }
    class Notification {
        +int notification_id
        +int user_id
        +int rental_id
        +int created_by
        +string notification_type
        +string title
        +bool is_read
        +datetime created_at
    }

    Role "1" --> "0..*" User : assigns
    Role "1" --> "0..*" RolePermission
    Permission "1" --> "0..*" RolePermission
    RentalPackage "1" --> "0..*" OrderItem : priced as
    MushroomType "1" --> "0..*" OrderItem : spawn item
    MushroomType "1" --> "0..*" MushroomCondition
    User "1" --> "0..*" Order : places
    Order "1" *-- "1..*" OrderItem : contains
    Order "1" --> "0..*" Payment : paid by
    Order "1" --> "0..*" Shipment : fulfilled by
    Order "1" --> "0..1" Rental : creates
    User "1" --> "0..*" Rental : leases
    CultivationRoom "1" --> "0..*" CultivationFloor : contains
    CultivationRoom "1" --> "0..*" CultivationTray : contains
    CultivationFloor "0..1" --> "0..*" CultivationTray : locates
    CultivationTray "1" --> "0..*" Rental : assigned over time
    Rental "1" --> "0..*" CultivationSession : tracks
    CultivationTray "1" --> "0..*" CultivationSession : grows on
    MushroomType "1" --> "0..*" CultivationSession : selected species
    CultivationSession "1" *-- "0..*" CultivationProgress : progress history
    CultivationSession "1" *-- "0..*" Harvest : harvest records
    User "1" --> "0..*" Notification : receives
    User "0..1" --> "0..*" Notification : creates
    Rental "0..1" --> "0..*" Notification : relates to
```

## 2. IoT, cảm biến và tự động hóa

```mermaid
classDiagram
    direction LR

    class CultivationRoom {
        +int room_id
        +string room_code
        +string room_name
    }
    class CultivationFloor {
        +int floor_id
        +int room_id
        +int master_id
        +int node_address
        +int misting_ssr_channel
    }
    class User {
        +int user_id
        +string full_name
    }
    class IoTDevice {
        +int device_id
        +int room_id
        +string device_code
        +string device_type
        +string status
        +datetime last_seen_at
    }
    class SensorData {
        +long sensor_data_id
        +int device_id
        +string sensor_type
        +decimal value
        +string unit
        +datetime recorded_at
    }
    class Camera {
        +int camera_id
        +int room_id
        +string camera_code
        +string stream_url
        +string status
    }
    class IoTMaster {
        +int id
        +string master_identifier
        +int cultivation_room_id
        +string reported_status
        +datetime last_seen_at
        +int light_ssr_channel
    }
    class IoTSensorReading {
        +long id
        +int master_id
        +int node_address
        +int sensor_address
        +decimal temperature
        +decimal humidity
        +bool is_valid
        +datetime received_at
    }
    class IoTSensorLatest {
        +int master_id
        +int node_address
        +int sensor_address
        +decimal temperature
        +decimal humidity
        +bool is_valid
        +datetime last_received_at
    }
    class IoTSSRState {
        +long id
        +int master_id
        +int channel
        +string desired_state
        +string reported_state
    }
    class IoTDeviceCommand {
        +uuid id
        +int master_id
        +int channel
        +string action
        +string status
        +int requested_by
        +datetime requested_at
    }
    class AutoControlConfig {
        +int id
        +int floor_id
        +int mushroom_type_id
        +string config_source
        +decimal humidity_min
        +decimal humidity_max
        +bool cooling_enabled
        +int configured_by
    }
    class AutoControlRun {
        +int id
        +int floor_id
        +int config_id
        +bool dry_run
        +string status
        +int started_by
        +int stopped_by
    }
    class AutoControlRuntime {
        +int floor_id
        +int run_id
        +string control_state
        +bool demand
        +bool cooling_demand
        +string last_error
    }
    class AutoControlLog {
        +long id
        +int floor_id
        +int run_id
        +uuid command_id
        +string event_type
        +decimal average_humidity
        +decimal average_temperature
    }

    CultivationRoom "1" --> "0..*" IoTDevice : maps
    CultivationRoom "1" --> "0..*" Camera : monitors
    CultivationRoom "1" --> "0..*" IoTMaster : contains
    CultivationRoom "1" --> "0..*" CultivationFloor : has
    IoTDevice "1" *-- "0..*" SensorData : records
    IoTMaster "1" *-- "0..*" IoTSensorReading : receives
    IoTMaster "1" *-- "0..*" IoTSensorLatest : caches by sensor
    IoTMaster "1" *-- "0..*" IoTSSRState : controls
    IoTMaster "1" *-- "0..*" IoTDeviceCommand : executes
    IoTMaster "1" --> "0..*" CultivationFloor : assigned to
    CultivationFloor "1" --> "0..1" AutoControlConfig : configured by
    AutoControlConfig "1" --> "0..*" AutoControlRun : starts
    CultivationFloor "1" --> "0..*" AutoControlRun : runs
    CultivationFloor "1" --> "0..1" AutoControlRuntime : runtime state
    AutoControlRun "0..1" --> "0..*" AutoControlLog : logs
    CultivationFloor "1" --> "0..*" AutoControlLog : records
    IoTDeviceCommand "0..1" --> "0..*" AutoControlLog : referenced by
    User "0..1" --> "0..*" IoTDeviceCommand : requests
    User "0..1" --> "0..*" AutoControlConfig : configures
    User "0..1" --> "0..*" AutoControlRun : starts or stops
```

> `IoTDevice`/`SensorData` là cấu trúc tích hợp thiết bị dạng cũ; `IoTMaster` và các lớp `IoT*` là luồng MQTT/automation mới hơn. Sơ đồ giữ riêng hai cấu trúc vì chúng là các bảng riêng trong schema.

## 3. Lớp miền cần bổ sung để phủ đủ Functional Requirements

Các lớp dưới đây là đề xuất cho yêu cầu chức năng, **chưa có bảng tương ứng trong schema hiện tại**. Nên bổ sung trước khi triển khai các luồng này.

```mermaid
classDiagram
    direction LR

    class Reservation {
        <<planned>>
        +int reservation_id
        +int user_id
        +datetime expires_at
        +string status
    }
    class DisputeTicket {
        <<planned>>
        +int ticket_id
        +int customer_id
        +int order_id
        +string reason
        +string status
        +datetime reported_at
    }
    class Refund {
        <<planned>>
        +int refund_id
        +int payment_id
        +int authorized_by
        +string refund_type
        +decimal amount
        +string status
    }
    class GrowthEvidence {
        <<planned>>
        +int evidence_id
        +int progress_id
        +int uploaded_by
        +string photo_url
        +datetime uploaded_at
    }
    class HarvestFulfillment {
        <<planned>>
        +int fulfillment_id
        +int harvest_id
        +string method
        +string status
        +datetime confirmed_at
    }
    class ActivityLog {
        <<planned>>
        +long log_id
        +int actor_id
        +string action
        +string target_type
        +datetime created_at
    }

    User "1" --> "0..*" Reservation : creates
    RentalPackage "1" --> "0..*" Reservation : reserves
    CultivationTray "0..1" --> "0..*" Reservation : allocates
    User "1" --> "0..*" DisputeTicket : reports
    Order "1" --> "0..*" DisputeTicket : concerns
    DisputeTicket "1" --> "0..*" Refund : may authorize
    Payment "1" --> "0..*" Refund : refunded from
    User "0..1" --> "0..*" Refund : authorizes
    CultivationProgress "1" *-- "0..*" GrowthEvidence : verifies
    User "1" --> "0..*" GrowthEvidence : uploads
    Harvest "1" --> "0..1" HarvestFulfillment : fulfilled by
    User "1" --> "0..*" ActivityLog : performs
```

## Mapping với cấu trúc backend

Các lớp miền hiện có được truy cập theo luồng `routes -> controllers -> services -> models -> PostgreSQL`. Ví dụ, nhóm `rentalPackage`, `order`, `rental`, `cultivationTray`, `mushroomType`, `iot` và `autoMisting` có model/service tương ứng trong `src/`. Diagram tập trung vào entity và quan hệ dữ liệu, không biểu diễn từng lớp HTTP/controller.

Một số chênh lệch đáng chú ý giữa yêu cầu và backend hiện tại:

- OTP được xử lý trong `auth.service.js` và lưu trạng thái trên `users`; không có entity/bảng OTP độc lập.
- Schema có các bảng `rental_packages`, `cultivation_progress`, `harvests`, `notifications`, nhưng chưa có bảng giữ chỗ 5 phút, dispute ticket, refund authorization, ảnh xác minh tiến độ, fulfillment theo từng harvest hay activity log.
- Backend đã tích hợp PayOS. Để yêu cầu chức năng nhất quán với hệ thống, thay cụm “SePay” bằng “PayOS” trong yêu cầu thanh toán: “complete payments via integrated payment gateways (PayOS)”.
- Các lớp đề xuất trong mục 3 không được thể hiện như tính năng đã tồn tại.
