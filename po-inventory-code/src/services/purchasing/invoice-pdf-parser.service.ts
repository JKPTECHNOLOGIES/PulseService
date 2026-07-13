/**
 * Invoice PDF Parser Service
 *
 * Extracts invoice data from uploaded PDF files.
 * Uses Python + PyPDF2 via child process for reliable text extraction
 * that works with any Next.js bundler (webpack, Turbopack).
 */

import { exec } from 'child_process';
import { writeFile, unlink, mkdir } from 'fs/promises';
import { join } from 'path';
import { randomUUID } from 'crypto';
import { logger } from '@/lib/logger';

export interface ExtractedInvoiceData {
  invoiceNumber: string | null;
  invoiceDate: string | null;
  totalAmount: number | null;
  dueDate: string | null;
  poNumber: string | null;
  supplierName: string | null;
  confidence: 'high' | 'medium' | 'low';
  rawText: string;
}

function runPython(scriptPath: string, pdfPath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const cmd = `python "${scriptPath}" "${pdfPath}"`;
    
    exec(cmd, { maxBuffer: 10 * 1024 * 1024, timeout: 60000 }, (error, stdout, stderr) => {
      if (stderr) {
        logger.debug('[InvoicePDFParser] Python debug:', stderr);
      }
      if (error) {
        reject(new Error(`Python script failed: ${error.message}`));
        return;
      }
      resolve(stdout);
    });
  });
}

export class InvoicePDFParserService {
  static async extractInvoiceData(pdfBuffer: Buffer): Promise<ExtractedInvoiceData> {
    const tempDir = join(process.cwd(), 'tmp');
    const tempFile = join(tempDir, `invoice-${randomUUID()}.pdf`);
    const scriptPath = join(process.cwd(), 'scripts', 'extract-invoice-data.py');
    
    try {
      logger.info('[InvoicePDFParser] Starting extraction, buffer size:', pdfBuffer.length, 'bytes');
      
      // Write buffer to temp file
      await mkdir(tempDir, { recursive: true });
      await writeFile(tempFile, pdfBuffer);
      
      // Run Python extraction
      const stdout = await runPython(scriptPath, tempFile);
      
      // Parse result
      let result: Record<string, unknown>;
      try {
        const parsed: unknown = JSON.parse(stdout.trim());
        if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
          return emptyResult('JSON parse error: unexpected format');
        }
        result = parsed as Record<string, unknown>;
      } catch {
        logger.error('[InvoicePDFParser] Failed to parse Python output:', stdout.substring(0, 500));
        return emptyResult(`JSON parse error: ${stdout.substring(0, 200)}`);
      }
      
      if (result.error) {
        logger.error('[InvoicePDFParser] Python error:', String(result.error));
      }
      
      const data: ExtractedInvoiceData = {
        invoiceNumber: (result.invoiceNumber as string) || null,
        invoiceDate: (result.invoiceDate as string) || null,
        totalAmount: result.totalAmount != null ? Number(result.totalAmount) : null,
        dueDate: (result.dueDate as string) || null,
        poNumber: (result.poNumber as string) || null,
        supplierName: (result.supplierName as string) || null,
        confidence: result.confidence ? (result.confidence as 'high' | 'medium' | 'low') : 'low',
        rawText: (result.rawText as string) || '',
      };
      
      logger.info('[InvoicePDFParser] Extracted:', {
        invoiceNumber: data.invoiceNumber,
        invoiceDate: data.invoiceDate,
        totalAmount: data.totalAmount,
        poNumber: data.poNumber,
        confidence: data.confidence,
      });
      
      return data;
    } catch (error) {
      logger.error('[InvoicePDFParser] Error:', error instanceof Error ? error.message : String(error));
      return emptyResult(error instanceof Error ? error.message : String(error));
    } finally {
      try { await unlink(tempFile); } catch { /* ignore cleanup errors */ }
    }
  }
}

function emptyResult(rawText: string): ExtractedInvoiceData {
  return {
    invoiceNumber: null,
    invoiceDate: null,
    totalAmount: null,
    dueDate: null,
    poNumber: null,
    supplierName: null,
    confidence: 'low',
    rawText,
  };
}
