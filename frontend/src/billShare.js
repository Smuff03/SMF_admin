/**
 * Share a bill as a PDF, no printing needed.
 *
 * Needs two packages:   npm i html2canvas jspdf
 * (loaded only when a bill is opened, so the rest of the app stays light)
 */

export const customerNameOf = (o) =>
    typeof o?.customer === 'object' && o.customer
        ? (o.customer.name || o.customer.fullName || o.customer.email || 'Customer')
        : (o?.customer || 'Customer');

/** "Rohan Mehta" on 29 Oct 2026  ->  "Rohan_Mehta_crunchzy_29-10-2026.pdf" */
export function billFileName(order) {
    const name = String(customerNameOf(order))
        .trim()
        .replace(/[^\p{L}\p{N}]+/gu, '_')
        .replace(/^_+|_+$/g, '') || 'Customer';
    const d = new Date(order.createdAt || Date.now());
    const date = [String(d.getDate()).padStart(2, '0'), String(d.getMonth() + 1).padStart(2, '0'), d.getFullYear()].join('-');
    return `${name}_crunchzy_${date}.pdf`;
}

/** Indian mobile numbers: 98220 41822 -> 919822041822. Other numbers are used as typed (digits only). */
export function whatsappNumber(raw) {
    const d = String(raw || '').replace(/\D/g, '');
    if (!d) return '';
    if (d.length === 10) return `91${d}`;
    if (d.length === 11 && d.startsWith('0')) return `91${d.slice(1)}`;
    return d;
}

const rupees = (n) => `₹${Number(n || 0).toLocaleString('en-IN')}`;

export function billMessage(order) {
    return [
        `Hello ${customerNameOf(order)},`,
        `Thank you for ordering from Crunchzy! 🙏`,
        `Your bill #${order.id} for ${rupees(order.amount)} is attached.`,
        `www.crunchzy.in`,
    ].join('\n');
}

/** Turns the on-screen invoice (the node marked data-bill-capture) into a single-page PDF File. */
export async function makeBillPdf(node, fileName) {
    const [{ default: html2canvas }, { jsPDF }] = await Promise.all([import('html2canvas'), import('jspdf')]);

    const canvas = await html2canvas(node, {
        scale: 2,
        backgroundColor: '#ffffff',
        useCORS: true,
        // Render with desktop-width media queries so the PDF always has the full itemised table,
        // even when the bill is opened on a phone.
        windowWidth: 900,
        ignoreElements: (el) => el.classList?.contains('no-print'),
        onclone: (doc) => {
            const target = doc.querySelector('[data-bill-capture]');
            if (!target) return;
            target.style.width = '840px';
            target.style.maxWidth = 'none';
            // The invoice sits in a scrolling modal; un-clip every parent so the whole bill is captured.
            for (let el = target.parentElement; el; el = el.parentElement) {
                el.style.overflow = 'visible';
                el.style.maxHeight = 'none';
                el.style.height = 'auto';
                el.style.transform = 'none';
            }
        },
    });

    const pageW = 210; // mm, A4 width
    const pageH = Math.max(297, (canvas.height * pageW) / canvas.width);
    const pdf = new jsPDF({ unit: 'mm', format: [pageW, pageH], compress: true });
    pdf.addImage(canvas.toDataURL('image/jpeg', 0.92), 'JPEG', 0, 0, pageW, (canvas.height * pageW) / canvas.width);
    return new File([pdf.output('blob')], fileName, { type: 'application/pdf' });
}

export function downloadFile(file) {
    const url = URL.createObjectURL(file);
    const a = Object.assign(document.createElement('a'), { href: url, download: file.name });
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
}

/**
 * Phones: opens the share sheet with the PDF attached - pick WhatsApp and the customer.
 * Desktop: saves the PDF and opens a WhatsApp chat with the customer's number and a ready message
 *          (WhatsApp Web can't attach files from a link, so drag the saved PDF into the chat).
 * Returns 'shared' | 'downloaded' | 'cancelled'.
 */
export async function shareBillOnWhatsApp(order, file) {
    const text = billMessage(order);
    if (navigator.canShare?.({ files: [file] })) {
        try {
            await navigator.share({ files: [file], title: file.name, text });
            return 'shared';
        } catch (e) {
            if (e?.name === 'AbortError') return 'cancelled';
            // any other failure: fall through to the download + chat route
        }
    }
    downloadFile(file);
    window.open(`https://wa.me/${whatsappNumber(order.phone)}?text=${encodeURIComponent(text)}`, '_blank', 'noopener');
    return 'downloaded';
}