import { Injectable, NotFoundException } from '@nestjs/common';
import bwipjs from 'bwip-js';
import PDFDocument from 'pdfkit';
import { BrandService } from '../common/brand.service.js';
import { slotLabel } from '../common/ist.js';
import { PrismaService } from '../prisma/prisma.service.js';

const ORANGE = '#FE5F00';
const GREEN = '#128807';
const NAVY = '#05051F';
const MUTED = '#667085';

// The built-in PDF fonts have no rupee sign, so amounts print as "Rs.".
const rs = (n: number) => `Rs. ${n.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;

function toBuffer(doc: PDFKit.PDFDocument): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    doc.end();
  });
}

function wordmark(doc: PDFKit.PDFDocument, x: number, y: number, size: number) {
  doc.font('Helvetica-Bold').fontSize(size).fillColor(ORANGE).text('D2C', x, y, { continued: true });
  doc.fillColor(GREEN).text(' ECOMMERCE', { continued: true });
  doc.fillColor(NAVY).font('Helvetica').fontSize(size * 0.7).text('  LOGISTICS');
}

@Injectable()
export class DocumentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly brands: BrandService,
  ) {}

  /** 4 x 6 inch shipping label. */
  async label(shipmentId: string): Promise<Buffer> {
    const brandId = await this.brands.currentBrandId();
    const s = await this.prisma.shipment.findFirst({
      where: { id: shipmentId, brandId },
      include: { courier: true, pickup: true, order: { include: { pickupWarehouse: true, rtoWarehouse: true } } },
    });
    if (!s) throw new NotFoundException('Shipment not found');
    const o = s.order;
    const W = 288;
    const H = 432;
    const doc = new PDFDocument({ size: [W, H], margin: 0, info: { Title: `Label ${s.awb}` } });

    wordmark(doc, 14, 14, 11);
    doc.font('Helvetica-Bold').fontSize(16).fillColor(NAVY).text(s.courier.name, 14, 34, { width: W - 28 });
    if (s.isDemo) {
      doc.save().roundedRect(W - 76, 34, 62, 18, 4).fill('#FFFAEB').restore();
      doc.font('Helvetica-Bold').fontSize(9).fillColor('#B54708').text('DEMO', W - 76, 39, { width: 62, align: 'center' });
    }

    const barcode = await bwipjs.toBuffer({ bcid: 'code128', text: s.awb, scale: 3, height: 14, includetext: false });
    doc.image(barcode, 14, 62, { width: W - 28, height: 58 });
    doc.font('Courier-Bold').fontSize(14).fillColor(NAVY).text(s.awb, 14, 124, { width: W - 28, align: 'center' });

    doc.moveTo(14, 146).lineTo(W - 14, 146).strokeColor('#E6EAF0').stroke();
    doc.font('Helvetica').fontSize(8).fillColor(MUTED).text('DELIVER TO', 14, 154);
    doc.font('Helvetica-Bold').fontSize(13).fillColor(NAVY).text(o.customerName, 14, 166, { width: W - 28 });
    doc
      .font('Helvetica')
      .fontSize(10)
      .fillColor(NAVY)
      .text(`${o.addressLine}${o.city ? `, ${o.city}` : ''}${o.state ? `, ${o.state}` : ''}`, 14, 184, { width: W - 28 });
    doc.font('Helvetica-Bold').fontSize(16).text(`PIN ${o.pincode}`, 14, doc.y + 4);
    doc.font('Helvetica').fontSize(10).text(`Mobile ${o.customerPhone}`, 14, doc.y + 2);

    const payY = 278;
    const cod = o.paymentMode === 'COD';
    doc.save().roundedRect(14, payY, W - 28, 40, 6).fill(cod ? '#FFF3EB' : '#EDF8EC').restore();
    doc
      .font('Helvetica-Bold')
      .fontSize(cod ? 15 : 13)
      .fillColor(cod ? '#E05400' : GREEN)
      .text(cod ? `COLLECT ${rs(Number(o.codAmount))}` : 'PREPAID · DO NOT COLLECT', 14, payY + (cod && Number(o.codAdvance) > 0 ? 8 : 13), { width: W - 28, align: 'center' });
    if (cod && Number(o.codAdvance) > 0) {
      doc
        .font('Helvetica')
        .fontSize(8)
        .fillColor('#B54708')
        .text(`Advance ${rs(Number(o.codAdvance))} paid online · order total ${rs(Number(o.orderValue))}`, 14, payY + 26, { width: W - 28, align: 'center' });
    }

    doc.font('Helvetica').fontSize(8.5).fillColor(MUTED);
    doc.text(`Order #${o.orderNumber}${o.productBrand ? ` · ${o.productBrand}` : ''}`, 14, 328);
    doc.text(`${s.chargedWeightG / 1000} kg · ${o.lengthCm}x${o.breadthCm}x${o.heightCm} cm`, 14, 340);
    if (s.pickup) doc.text(`Pickup ${slotLabel(s.pickup.slotStart)} · ${s.pickup.slotStart.toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short' })}`, 14, 352);

    doc.moveTo(14, 368).lineTo(W - 14, 368).strokeColor('#E6EAF0').stroke();
    const from = o.pickupWarehouse;
    const ret = o.rtoWarehouse ?? from;
    doc.fontSize(7.5).fillColor(MUTED).text('FROM', 14, 374).text('RETURN TO', W / 2 + 4, 374);
    doc.fontSize(8).fillColor(NAVY);
    doc.text(`${from.name}\n${from.city} ${from.pincode}`, 14, 384, { width: W / 2 - 18 });
    doc.text(`${ret.name}\n${ret.city} ${ret.pincode}`, W / 2 + 4, 384, { width: W / 2 - 18 });

    return toBuffer(doc);
  }

  /** Pickup manifest: every parcel the courier collects in one slot, with signatures. */
  async manifest(pickupId: string): Promise<Buffer> {
    const brandId = await this.brands.currentBrandId();
    const p = await this.prisma.pickup.findFirst({
      where: { id: pickupId, brandId },
      include: { courier: true, warehouse: true, shipments: { include: { order: true }, orderBy: { createdAt: 'asc' } } },
    });
    if (!p) throw new NotFoundException('Pickup not found');
    const doc = new PDFDocument({ size: 'A4', margin: 40, info: { Title: `Manifest ${p.warehouse.name}` } });

    wordmark(doc, 40, 40, 14);
    doc.font('Helvetica-Bold').fontSize(18).fillColor(NAVY).text('Pickup manifest', 40, 70);
    doc.font('Helvetica').fontSize(10).fillColor(MUTED);
    doc.text(
      `${p.warehouse.name}, ${p.warehouse.city} ${p.warehouse.pincode}  ·  ${p.courier.name}  ·  ${p.slotStart.toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', weekday: 'short', day: 'numeric', month: 'short' })}, ${slotLabel(p.slotStart)}`,
      40,
      94,
    );
    doc.text(`${p.shipments.length} parcel${p.shipments.length === 1 ? '' : 's'}${p.shipments.some((s) => s.isDemo) ? '  ·  DEMO courier' : ''}`, 40, 108);

    const cols = [
      { h: '#', w: 24 },
      { h: 'AWB', w: 120 },
      { h: 'Order', w: 60 },
      { h: 'Customer', w: 110 },
      { h: 'Pin code', w: 60 },
      { h: 'Payment', w: 80 },
      { h: 'Weight', w: 61 },
    ];
    let y = 134;
    const row = (cells: string[], bold = false) => {
      let x = 40;
      doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(9).fillColor(bold ? MUTED : NAVY);
      cells.forEach((c, i) => {
        doc.text(c, x, y, { width: cols[i].w - 6, lineBreak: false, ellipsis: true });
        x += cols[i].w;
      });
      y += 20;
      doc.moveTo(40, y - 6).lineTo(555, y - 6).strokeColor('#E6EAF0').stroke();
    };
    row(cols.map((c) => c.h), true);
    p.shipments.forEach((s, i) =>
      row([
        String(i + 1),
        s.awb,
        s.order.orderNumber,
        s.order.customerName,
        s.order.pincode,
        s.order.paymentMode === 'COD' ? `COD ${rs(Number(s.order.codAmount))}` : 'Prepaid',
        `${s.chargedWeightG / 1000} kg`,
      ]),
    );

    y += 30;
    doc.font('Helvetica').fontSize(10).fillColor(NAVY);
    doc.text('Handed over by (vendor)', 40, y).text('Received by (courier executive)', 320, y);
    doc.moveTo(40, y + 40).lineTo(260, y + 40).moveTo(320, y + 40).lineTo(555, y + 40).strokeColor(MUTED).stroke();
    doc.fontSize(8).fillColor(MUTED).text('Name, signature, time', 40, y + 46).text('Name, signature, time', 320, y + 46);

    return toBuffer(doc);
  }
}
