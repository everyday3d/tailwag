import {
  generateNative3mfPackage,
  generateNoAmsStlPackageZip,
} from './exporter3mf';
import { generateBinaryStlFromGrid } from './cadMeshBuilder';
import {
  ExportVerificationError,
  verify3mfAgainstPlan,
  verifyNoAmsBundleAgainstPlan,
  verifyStlAgainstPlan,
  type VerificationReport,
} from './verifyExport';

type Native3mfParams = Parameters<typeof generateNative3mfPackage>[0];
type NoAmsParams = Parameters<typeof generateNoAmsStlPackageZip>[0];

export interface VerifiedExport<T> {
  data: T;
  /** Warnings only: a report with errors is thrown instead of returned. */
  report: VerificationReport;
}

/**
 * Builds the 3MF, re-reads the written bytes and compares them with the plan.
 * Throws ExportVerificationError when anything mismatches, so no wrong file ever reaches disk.
 */
export function generateVerified3mfPackage(params: Native3mfParams): VerifiedExport<Uint8Array> {
  const data = generateNative3mfPackage(params);
  const plan = params.plan;
  if (!plan) throw new Error('A PrintPlan is required to verify an export.');
  const report = verify3mfAgainstPlan(data, plan, params.grid);
  if (!report.ok) throw new ExportVerificationError(report);
  return { data, report };
}

export function generateVerifiedNoAmsBundle(params: NoAmsParams): VerifiedExport<Uint8Array> {
  const data = generateNoAmsStlPackageZip(params);
  const plan = params.plan;
  if (!plan) throw new Error('A PrintPlan is required to verify an export.');
  const report = verifyNoAmsBundleAgainstPlan(data, plan, params.grid);
  if (!report.ok) throw new ExportVerificationError(report);
  return { data, report };
}

export function generateVerifiedStl(
  grid: Parameters<typeof generateBinaryStlFromGrid>[0],
  plan: NonNullable<Native3mfParams['plan']>
): VerifiedExport<ArrayBuffer> {
  const data = generateBinaryStlFromGrid(grid, `Plan ${plan.hash}`);
  const report = verifyStlAgainstPlan(data, plan, grid);
  if (!report.ok) throw new ExportVerificationError(report);
  return { data, report };
}
