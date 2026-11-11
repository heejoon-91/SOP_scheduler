/**
 * 기본 템플릿 (설계 문서 "데이터 모델 › 기본 템플릿").
 * 회사 SOP마다 같은 의무 뼈대를 다시 만들지 않고, 템플릿의 각 의무를 회사 SOP 조항에 연결한다.
 */
import type { DeadlineRule } from '../deadline/types';
import type { ObligationType } from '../extract/candidates';

export interface TemplateObligation {
  /** 예: "KULF-COM-T064" */
  id: string;
  /** 원천 매트릭스 행 번호 */
  no: number;
  type: ObligationType;
  /** 단계·주기 (매트릭스 원문) */
  stage: string;
  /** 트리거 / 주기 (매트릭스 원문) */
  trigger: string;
  task: string;
  /** 기한 (매트릭스 원문). 사람이 검수할 때 기준이 되는 값 */
  deadlineText: string;
  /** 기한 문구를 규칙으로 바꾼 초안. 검수 전에는 참고용 */
  deadlineDraft: { phrase: string; rule: DeadlineRule }[];
  forms: { code: string; name: string }[];
  /** 서식 칸 원문 (코드 없는 기록처 포함: "희석용기 라벨" 등) */
  formText: string;
  actor: string;
  recipients: string;
  /** 템플릿을 만든 SOP의 근거 조항 */
  source: { sop: string; path: string; text: string }[];
  /** 근거 법령 조항 (지정규정 등). 검수 때 채운다 */
  legalBasis: string[];
  match: {
    /** 사람이 읽고 고칠 수 있는 매칭 키워드 */
    keywords: string[];
    /** 서식 이름 후보 (회사마다 서식 번호가 달라 이름으로 찾는다) */
    formNames: string[];
    /** 유사도 계산에 쓰는 대표 문장 (할 일 + 트리거 + 근거 조항 원문) */
    profile: string;
  };
  status: 'draft' | 'reviewed';
}

export interface TemplateSet {
  name: string;
  version: string;
  createdAt: string;
  /** 템플릿을 만든 원천 (매트릭스 파일, SOP 파일) */
  sources: string[];
  /** 공개 배포 전 확인 사항 */
  notice: string;
  obligations: TemplateObligation[];
}
