import { useState, useRef, useEffect } from "react";
import { saveTOSAccepted } from "../lib/persistence";

export function TermsOfService({ onAccepted }: { onAccepted: () => void }) {
  const [hasScrolledToBottom, setHasScrolledToBottom] = useState(false);
  const [agreed, setAgreed] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const handleScroll = () => {
      const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
      if (atBottom) setHasScrolledToBottom(true);
    };
    el.addEventListener("scroll", handleScroll);
    if (el.scrollHeight <= el.clientHeight + 40) setHasScrolledToBottom(true);
    return () => el.removeEventListener("scroll", handleScroll);
  }, []);

  const handleAccept = () => {
    saveTOSAccepted();
    onAccepted();
  };

  return (
    <div className="flex flex-col items-center justify-center h-screen bg-gray-50 dark:bg-zinc-900 p-6">
      <div className="w-full max-w-2xl flex flex-col" style={{ maxHeight: "90vh" }}>
        <div className="text-center mb-6">
          <div className="text-4xl mb-3">📜</div>
          <h1 className="text-2xl font-bold">Terms of Service</h1>
          <p className="text-gray-500 text-sm mt-1">Please review and accept before continuing</p>
        </div>

        <div
          ref={scrollRef}
          className="flex-1 overflow-y-auto card text-sm leading-relaxed mb-4"
          style={{ maxHeight: "55vh" }}
        >
          <p className="text-xs text-gray-400 mb-4">Effective Date: February 10, 2026</p>

          <p className="mb-3">These Terms of Service ("Terms") govern your use of the Sovereign Tax desktop application ("Software," "App," or "Product") developed and distributed by Sovereign Tax ("we," "us," or "our"). By purchasing, downloading, installing, or using the Software, you acknowledge that you have read, understood, and agree to be bound by these Terms. If you do not accept these Terms, you will not install, access, or otherwise use the Software.</p>

          <div className="bg-orange-50 dark:bg-orange-950/30 border border-orange-200 dark:border-orange-800 rounded-lg p-4 mb-4">
            <p className="font-semibold text-sm">PLEASE READ THESE TERMS CAREFULLY. They contain an agreement to arbitrate disputes, a class action waiver, a limitation on the time period in which claims may be brought, and other important provisions affecting your legal rights.</p>
          </div>

          <h3 className="font-semibold text-base mt-5 mb-2 text-orange-600">1. Eligibility</h3>
          <p className="mb-2">By using the Software, you represent and warrant that you are at least <strong>18 years of age</strong> and have the legal capacity to enter into a binding agreement. If you are using the Software on behalf of a company, organization, or other legal entity, you represent and warrant that you have the authority to bind that entity to these Terms.</p>

          <h3 className="font-semibold text-base mt-5 mb-2 text-orange-600">2. License Grant</h3>
          <p className="mb-2">Upon purchase, we grant you a <strong>non-exclusive, non-transferable, non-sublicensable, perpetual license</strong> to install and use one copy of the Software on up to <strong>two (2) devices</strong> that you personally own or control. This is a one-time purchase — no subscription or recurring fees are required.</p>
          <p className="mb-1 font-medium">You may not:</p>
          <ul className="list-disc ml-5 mb-2 space-y-1">
            <li>Redistribute, sublicense, rent, lease, loan, sell, resell, or otherwise transfer the Software</li>
            <li>Reverse-engineer, decompile, disassemble, or attempt to derive the source code</li>
            <li>Modify, copy, create derivative works from, or frame any portion of the Software</li>
            <li>Remove, alter, or obscure any proprietary notices, labels, or branding</li>
            <li>Use the Software to provide tax or financial services to third parties commercially</li>
            <li>Assign or transfer these Terms without our prior written consent</li>
          </ul>

          <h3 className="font-semibold text-base mt-5 mb-2 text-orange-600">3. Nature of the Software</h3>
          <p className="mb-2">Sovereign Tax is a <strong>local, offline desktop application</strong> that runs entirely on your device. The Software does not collect, transmit, or store any of your data on external servers. It does not require an internet connection to function (except for optional live BTC price fetching). It does not create user accounts or require personal information to operate. It encrypts all stored data locally using AES-256-GCM encryption.</p>
          <div className="bg-orange-50 dark:bg-orange-950/30 border border-orange-200 dark:border-orange-800 rounded-lg p-4 my-3">
            <p className="font-semibold text-sm">Your data is yours alone. We have no access to your financial data, transaction history, tax calculations, or any other information you enter into the Software. We cannot recover lost data or PINs because we do not have them.</p>
          </div>

          <h3 className="font-semibold text-base mt-5 mb-2 text-orange-600">4. No Financial, Tax, or Professional Advice; No Fiduciary Relationship</h3>
          <p className="mb-2"><strong>The Software is a calculation tool, not a tax advisor.</strong> No fiduciary relationship has been created between you and Sovereign Tax by virtue of your use of the Software. You acknowledge and agree that:</p>
          <ul className="list-disc ml-5 mb-2 space-y-1">
            <li>The Software does not provide tax, legal, financial, investment, accounting, or other professional advice</li>
            <li>All calculations, reports, and outputs are for <strong>informational purposes only</strong></li>
            <li>You are solely responsible for the accuracy of the data you input and for verifying all calculations and tax filings</li>
            <li>Tax laws vary by jurisdiction and change over time — the Software may not reflect your specific tax obligations</li>
            <li>You should consult a qualified tax professional before making tax decisions based on outputs from the Software</li>
          </ul>

          <h3 className="font-semibold text-base mt-5 mb-2 text-orange-600">5. Accuracy and Data Responsibility</h3>
          <p className="mb-2">We make <strong>no guarantees</strong> that the outputs are error-free or suitable for filing with any tax authority. The accuracy of results depends entirely on the accuracy and completeness of the data you provide. You are responsible for ensuring all imported data is accurate, selecting the correct accounting method, reviewing all generated reports before filing, and maintaining your own backups.</p>

          <h3 className="font-semibold text-base mt-5 mb-2 text-orange-600">6. Data Loss and Recovery</h3>
          <p className="mb-2">Because the Software operates entirely offline with local encryption:</p>
          <ul className="list-disc ml-5 mb-2 space-y-1">
            <li><strong>We cannot recover your data</strong> if you lose your device, forget your PIN, or fail to create backups</li>
            <li><strong>We cannot reset your PIN</strong> — this is a security feature, not a limitation</li>
            <li>You are solely responsible for creating and securely storing encrypted backups</li>
            <li>Any damage that may occur to you, through your computer system, or as a result of loss of your data from your use of the Software is your sole responsibility</li>
          </ul>

          <h3 className="font-semibold text-base mt-5 mb-2 text-orange-600">7. Security Disclaimer and Assumption of Risk</h3>
          <p className="mb-2">While the Software employs industry-standard encryption (AES-256-GCM) and is designed with security as a priority, <strong>we cannot and do not guarantee that the Software is completely secure or immune from vulnerabilities, exploits, or unauthorized access.</strong> No software, regardless of its design or encryption methods, can guarantee absolute security.</p>
          <p className="mb-1">You acknowledge and agree that:</p>
          <ul className="list-disc ml-5 mb-2 space-y-1">
            <li>You assume full responsibility for the security of your own data, devices, and operating environment</li>
            <li>You are solely responsible for maintaining the security of the device(s) on which the Software is installed</li>
            <li>You are solely responsible for safeguarding your PIN and ensuring unauthorized individuals do not gain access to your device or the Software</li>
            <li>Sovereign Tax is not responsible for any unauthorized access to your data resulting from malware, viruses, keyloggers, device theft, compromised operating systems, or any other security vulnerability on your device or network</li>
            <li>Sovereign Tax is not responsible for any data breach, data loss, or security incident arising from circumstances beyond our reasonable control</li>
            <li>You use the Software at your own risk and assume all responsibility for any consequences arising from the storage of sensitive financial data on your device</li>
          </ul>
          <p className="mb-2 font-semibold uppercase text-xs">SOVEREIGN TAX EXPRESSLY DISCLAIMS ANY AND ALL LIABILITY FOR DAMAGES OF ANY KIND ARISING FROM ANY SECURITY BREACH, UNAUTHORIZED ACCESS, OR DATA COMPROMISE RELATING TO YOUR USE OF THE SOFTWARE OR THE DEVICE ON WHICH IT IS INSTALLED.</p>

          <h3 className="font-semibold text-base mt-5 mb-2 text-orange-600">8. Payment and Refunds</h3>
          <p className="mb-2">Sovereign Tax is sold as a <strong>one-time purchase</strong> through our authorized payment processor. Payments made are final and non-refundable unless otherwise determined by Sovereign Tax at its sole discretion. Payment processing services are subject to the processor's terms and conditions. Refunds are not available once you have used the Software to generate, export, or download any tax reports, Form 8949 documents, CSV files, or PDF files.</p>

          <h3 className="font-semibold text-base mt-5 mb-2 text-orange-600">9. Updates</h3>
          <p className="mb-2">We may release updates from time to time that include bug fixes, new features, or compatibility improvements. Updates are provided at our discretion and are not guaranteed. When updates are available, you will need to download and install the new version manually.</p>

          <h3 className="font-semibold text-base mt-5 mb-2 text-orange-600">10. Intellectual Property</h3>
          <p className="mb-2">The Software, including its code, design, user interface, documentation, algorithms, and branding, is protected by copyright, trademark, trade secret, and other intellectual property laws. The Sovereign Tax name and logos are trademarks of Sovereign Tax. All rights not expressly granted in these Terms are reserved.</p>

          <h3 className="font-semibold text-base mt-5 mb-2 text-orange-600">11. Prohibited Uses</h3>
          <p className="mb-1">You may not use the Software to:</p>
          <ul className="list-disc ml-5 mb-2 space-y-1">
            <li>Facilitate tax evasion, fraud, money laundering, terrorist financing, or any illegal activity</li>
            <li>Provide commercial tax preparation or financial services to others without a separate commercial license</li>
            <li>Circumvent, remove, or thwart any of the Software's security features or content protections</li>
            <li>Engage in any data mining, scraping, or extraction of the Software's code, data structures, or algorithms</li>
            <li>Use the Software in any manner that violates applicable law</li>
          </ul>

          <h3 className="font-semibold text-base mt-5 mb-2 text-orange-600">12. Competitor Restriction</h3>
          <p className="mb-2">No employee, agent, or affiliate of any competing provider of cryptocurrency tax or asset management software is permitted to access, use, or evaluate the Software without the express written permission of Sovereign Tax.</p>

          <h3 className="font-semibold text-base mt-5 mb-2 text-orange-600">13. Third-Party Services</h3>
          <p className="mb-2">The Software may optionally connect to third-party APIs (such as CoinGecko) solely to fetch current Bitcoin price data. Your access to and use of any third-party service is subject to that service's own terms. No personal or financial data is transmitted to these services. YOU EXPRESSLY RELIEVE SOVEREIGN TAX FROM ANY AND ALL LIABILITY THAT MAY ARISE FROM YOUR USE OF ANY THIRD-PARTY SERVICES.</p>

          <h3 className="font-semibold text-base mt-5 mb-2 text-orange-600">14. Disclaimer of Warranties</h3>
          <p className="mb-2 font-semibold uppercase text-xs">YOUR USE OF THE SOFTWARE IS AT YOUR SOLE RISK. THE SOFTWARE IS PROVIDED ON AN "AS IS" AND "AS AVAILABLE" BASIS. SOVEREIGN TAX EXPRESSLY DISCLAIMS ALL WARRANTIES OF ANY KIND, WHETHER EXPRESS, IMPLIED, OR STATUTORY, INCLUDING THE IMPLIED WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, TITLE, ACCURACY, AND NON-INFRINGEMENT.</p>
          <p className="mb-2 uppercase text-xs">WE MAKE NO WARRANTY THAT (A) THE SOFTWARE WILL MEET YOUR REQUIREMENTS; (B) THE SOFTWARE WILL BE UNINTERRUPTED, TIMELY, SECURE, OR ERROR-FREE; (C) THE RESULTS OBTAINED WILL BE ACCURATE OR RELIABLE; OR (D) THE QUALITY OF ANY REPORTS WILL MEET YOUR EXPECTATIONS OR BE SUITABLE FOR FILING WITH ANY TAX AUTHORITY.</p>

          <h3 className="font-semibold text-base mt-5 mb-2 text-orange-600">15. Limitation of Liability</h3>
          <p className="mb-2 font-semibold uppercase text-xs">SOVEREIGN TAX AND ITS DEVELOPERS SHALL NOT BE LIABLE FOR ANY INDIRECT, INCIDENTAL, SPECIAL, CONSEQUENTIAL, EXEMPLARY, OR PUNITIVE DAMAGES, INCLUDING ERRORS IN TAX CALCULATIONS, PENALTIES ASSESSED BY ANY TAX AUTHORITY, LOSS OF DATA, OR FINANCIAL LOSSES ARISING FROM RELIANCE ON THE SOFTWARE'S OUTPUTS.</p>
          <p className="mb-2 font-semibold uppercase text-xs">IN NO EVENT SHALL SOVEREIGN TAX'S TOTAL AGGREGATE LIABILITY EXCEED THE AMOUNT YOU HAVE PAID FOR THE SOFTWARE. YOUR SOLE AND EXCLUSIVE REMEDY IS TO DISCONTINUE USE OF THE SOFTWARE.</p>

          <h3 className="font-semibold text-base mt-5 mb-2 text-orange-600">16. Indemnification</h3>
          <p className="mb-2">You agree to defend, indemnify, and hold harmless Sovereign Tax, its developers, affiliates, and their respective officers, employees, agents, and licensors from any and all losses, damages, expenses, including reasonable attorneys' fees, arising out of your use of the Software, your violation of these Terms, or your filing of tax returns based on the Software's outputs. Sovereign Tax reserves the right to assume the exclusive defense and control of any matter subject to indemnification. You may not settle any claim against the Sovereign Tax Parties without our written consent.</p>

          <h3 className="font-semibold text-base mt-5 mb-2 text-orange-600">17. Dispute Resolution by Binding Arbitration</h3>
          <div className="bg-orange-50 dark:bg-orange-950/30 border border-orange-200 dark:border-orange-800 rounded-lg p-4 my-3">
            <p className="font-semibold text-sm">PLEASE READ THIS SECTION CAREFULLY — IT AFFECTS YOUR LEGAL RIGHTS.</p>
          </div>
          <p className="mb-2"><strong>Agreement to Arbitrate:</strong> Any disputes or claims between you and Sovereign Tax will be resolved exclusively through <strong>final and binding arbitration</strong>, rather than in court, except for individual claims in small claims court. You and Sovereign Tax are each waiving the right to a trial by jury.</p>
          <p className="mb-2"><strong>Class Action Waiver:</strong> YOU AND SOVEREIGN TAX AGREE THAT EACH MAY BRING CLAIMS AGAINST THE OTHER <strong>ONLY IN YOUR INDIVIDUAL CAPACITY</strong>, AND NOT AS A PLAINTIFF OR CLASS MEMBER IN ANY CLASS, CONSOLIDATED, OR REPRESENTATIVE ACTION.</p>
          <p className="mb-2"><strong>Arbitration Procedures:</strong> Arbitration will be conducted in accordance with the American Arbitration Association's rules and procedures, including Consumer Arbitration Rules.</p>
          <p className="mb-2"><strong>Pre-Arbitration Dispute Resolution:</strong> Before initiating arbitration, you must first send a written Notice of Dispute. If we do not resolve the claim within sixty (60) calendar days, you or Sovereign Tax may commence arbitration.</p>

          <h3 className="font-semibold text-base mt-5 mb-2 text-orange-600">18. Time Limitation on Claims</h3>
          <p className="mb-2"><strong>Any claim or cause of action arising out of or related to use of the Software or these Terms must be filed within one (1) year after such claim arose or be forever barred.</strong></p>

          <h3 className="font-semibold text-base mt-5 mb-2 text-orange-600">19. Termination</h3>
          <p className="mb-2">Your license to use the Software continues indefinitely unless terminated. We may terminate your license if you violate these Terms. Any suspected fraudulent, abusive, or illegal activity may be grounds for termination and may be referred to law enforcement. Upon termination, you must cease all use of the Software and delete all copies.</p>

          <h3 className="font-semibold text-base mt-5 mb-2 text-orange-600">20. Export Controls and Compliance</h3>
          <p className="mb-2">You will comply with all applicable import and export control and trade and economic sanctions laws and regulations. You represent and warrant that you are not located in any sanctioned country or territory and are not listed on any U.S. Government list of prohibited or restricted parties.</p>

          <h3 className="font-semibold text-base mt-5 mb-2 text-orange-600">21. Governing Law and Jurisdiction</h3>
          <p className="mb-2">These Terms shall be governed by and construed in accordance with the <strong>laws of the State of Wyoming, United States</strong>, without regard to its conflict of law provisions. For disputes not subject to arbitration, you submit to the exclusive jurisdiction of Wyoming state and federal courts.</p>

          <h3 className="font-semibold text-base mt-5 mb-2 text-orange-600">22. Changes to These Terms</h3>
          <p className="mb-2">We reserve the right to change or modify portions of these Terms at any time. Your continued use of the Software after changes become effective constitutes acceptance of the new Terms.</p>

          <h3 className="font-semibold text-base mt-5 mb-2 text-orange-600">23. Electronic Communications</h3>
          <p className="mb-2">By using the Software, you consent to receive electronic communications from us and agree that all such communications satisfy any legal requirement that they be in writing.</p>

          <h3 className="font-semibold text-base mt-5 mb-2 text-orange-600">24. Force Majeure</h3>
          <p className="mb-2">Sovereign Tax shall not be liable for any failure or delay in performance where such failure is due to circumstances beyond our reasonable control, including natural disasters, pandemics, war, acts of God, or unavailability of power or network access.</p>

          <h3 className="font-semibold text-base mt-5 mb-2 text-orange-600">25. Waiver</h3>
          <p className="mb-2">The failure of Sovereign Tax to exercise or enforce any right or provision of these Terms shall not constitute a waiver of such right or provision.</p>

          <h3 className="font-semibold text-base mt-5 mb-2 text-orange-600">26. Severability</h3>
          <p className="mb-2">If any provision of these Terms is found invalid or unenforceable, that provision shall be limited or eliminated to the minimum extent necessary so that the remaining provisions remain in full force and effect.</p>

          <h3 className="font-semibold text-base mt-5 mb-2 text-orange-600">27. Entire Agreement</h3>
          <p className="mb-2">These Terms constitute the entire agreement between you and Sovereign Tax regarding the Software and supersede all prior agreements, understandings, or communications, whether written or oral.</p>

          <div className="mt-6 pt-4 border-t border-gray-200 dark:border-gray-700 text-xs text-gray-400">
            © 2026 Sovereign Tax. All rights reserved.
          </div>
        </div>

        {!hasScrolledToBottom && (
          <p className="text-center text-xs text-gray-400 mb-3">↓ Scroll to read the full terms</p>
        )}

        <label className="flex items-center gap-3 justify-center mb-4 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={agreed}
            onChange={(e) => setAgreed(e.target.checked)}
            disabled={!hasScrolledToBottom}
            className="w-4 h-4 accent-orange-500"
          />
          <span className={`text-sm ${hasScrolledToBottom ? "" : "text-gray-400"}`}>
            I have read and agree to the Terms of Service
          </span>
        </label>

        <div className="text-center">
          <button
            className="btn-primary w-48"
            disabled={!agreed}
            style={{ opacity: agreed ? 1 : 0.3 }}
            onClick={handleAccept}
          >
            Continue
          </button>
        </div>
      </div>
    </div>
  );
}
