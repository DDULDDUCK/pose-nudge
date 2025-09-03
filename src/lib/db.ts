import Database from '@tauri-apps/plugin-sql';

// DB 인스턴스를 한 번만 로드하기 위한 싱글톤 패턴
let dbInstance: Database | null = null;

export const getDb = async (): Promise<Database> => {
  if (!dbInstance) {
    // preload에 설정된 DB를 로드합니다.
    dbInstance = await Database.load('sqlite:posture_data.db');
  }
  return dbInstance;
};