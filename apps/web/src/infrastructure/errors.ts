export class AppError extends Error {
  constructor(message: string, public readonly code: string, public readonly cause?: unknown) {
    super(message);
    this.name = "AppError";
  }
}
export class ValidationError extends AppError { constructor(message="Dữ liệu không hợp lệ", cause?: unknown){super(message,"VALIDATION_ERROR",cause);} }
export class NotFoundError extends AppError { constructor(message="Không tìm thấy dữ liệu", cause?: unknown){super(message,"NOT_FOUND",cause);} }
export class ConflictError extends AppError { constructor(message="Dữ liệu xung đột", cause?: unknown){super(message,"CONFLICT_ERROR",cause);} }
export class StorageError extends AppError { constructor(message="Không thể truy cập dữ liệu cục bộ", cause?: unknown){super(message,"STORAGE_ERROR",cause);} }
export class NetworkError extends AppError { constructor(message="Không thể kết nối máy chủ", cause?: unknown){super(message,"NETWORK_ERROR",cause);} }
export class SyncError extends AppError { constructor(message="Đồng bộ thất bại", cause?: unknown){super(message,"SYNC_ERROR",cause);} }
export class ImportError extends AppError { constructor(message="Không thể nhập dữ liệu", cause?: unknown){super(message,"IMPORT_ERROR",cause);} }
export class TimeoutError extends AppError { constructor(message="Yêu cầu hết thời gian", cause?: unknown){super(message,"TIMEOUT_ERROR",cause);} }
