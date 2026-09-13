import type { Metadata } from "next";
import { MarketingHeader } from "@/components/marketing/MarketingHeader";
import { MarketingFooter } from "@/components/marketing/MarketingFooter";

export const metadata: Metadata = {
  title: "Disclaimer — PROJEXA",
  description: "Disclaimer, Limitation of Liability and Notice of Rights for PROJEXA and all VERIDIAN AI OS products.",
};

// Same rationale as src/app/how-it-works/page.tsx: this page reads nothing
// from the request itself, but the shared root layout does (next-intl's
// getLocale()/getMessages() -> the NEXT_LOCALE cookie), which would
// otherwise make the route server-rendered on every request. `force-static`
// prerenders it once and revalidates hourly.
//
// English-only, same convention as /login and /signup (no /hi mirror):
// unlike "/" and "/how-it-works", this is a legal document, not translated
// marketing copy, so there is no Hindi variant to keep in sync.
//
// Disclaimer, Limitation of Liability and Notice of Rights -- full text of
// the owner-approved source document (VERIDIAN-Disclaimer-v2_1.docx),
// reformatted into this page's own layout (MarketingHeader/MarketingFooter,
// consistent with /how-it-works). Content is presented verbatim: no
// paraphrasing, shortening or legal-substance changes were made, only
// structural HTML (headings/paragraphs matching the source document's own
// 23 numbered sections). The source document contains literal placeholder
// tokens ("[INSERT CONTACT EMAIL]", "[INSERT WEBSITE]", "[INSERT DATE]")
// which are intentionally rendered as-is below -- do not invent values for
// them; the owner needs to fill these in.
export const dynamic = "force-static";
export const revalidate = 3600;

export default function DisclaimerPage() {
  return (
    <div lang="en" className="min-h-screen bg-background">
      <MarketingHeader />
      <article className="mx-auto max-w-4xl px-6 py-16">
        <h1 className="font-heading text-4xl text-foreground">Disclaimer, Limitation of Liability and Notice of Rights</h1>
        <p className="mt-2 text-sm text-muted-foreground">Version 2.0</p>
        <div className="legal-prose mt-10 space-y-8 leading-relaxed text-foreground/80 [&_h2]:font-heading [&_h2]:text-2xl [&_h2]:text-foreground [&_p+p]:mt-3">
      <div className="rounded-lg border border-border bg-muted/40 px-6 py-5 text-sm text-foreground">
        <p className="font-semibold">SHOBHA KAMAL SOLUTIONS PRIVATE LIMITED</p>
        <p>CIN: U74999UP2017PTC098453</p>
        <p>Registered Office: B-1105, Plot No. 14, Shipra Krishna Vista, Ahinsa Khand-1, Indirapuram, Ghaziabad, Uttar Pradesh 201014, India</p>
        <p>Email: [INSERT CONTACT EMAIL]   |   Website: [INSERT WEBSITE]</p>
        <p>Version 2.0   |   Effective from: [INSERT DATE]</p>
      </div>

      <div className="mt-8 rounded-lg border-2 border-destructive/40 bg-destructive/5 px-6 py-5">
        <p className="font-heading text-lg text-destructive">IMPORTANT — READ CAREFULLY BEFORE USING THE SERVICES</p>
        <p className="mt-2 text-sm text-foreground"><strong>THIS DISCLAIMER CONTAINS PROVISIONS THAT LIMIT AND EXCLUDE THE COMPANY'S LIABILITY, ALLOCATE RISK TO YOU, REQUIRE YOU TO INDEMNIFY THE COMPANY, AND REQUIRE DISPUTES TO BE RESOLVED BY ARBITRATION. BY ACCESSING OR USING THE SERVICES YOU ACCEPT THESE PROVISIONS IN FULL. IF YOU DO NOT ACCEPT THEM, YOU MUST NOT ACCESS OR USE THE SERVICES.</strong></p>
      </div>

      <section>
        <h2>1. Definitions and scope</h2>
        <p>In this Disclaimer:</p>
        <p>"Company", "we", "us", "our" means Shobha Kamal Solutions Private Limited (CIN U74999UP2017PTC098453), a company incorporated under the Companies Act, 2013, together with its directors, officers, employees, contractors, consultants, agents, licensors, suppliers, successors and assigns.</p>
        <p>"Platform" means the VERIDIAN AI OS ERP platform in all its versions, editions and deployments.</p>
        <p>"Products" means any software, platform, product, module, feature, application, website, application programming interface, dataset, template or service made available by the Company, including without limitation PROJEXA (projexa-ai.com) and VERIDIAN-AIOS (veridian-aios.com), and any product, module or service released, rebranded, renamed or acquired by the Company at any time in the future.</p>
        <p>"Services" means the Platform, the Products, the Company's websites, documentation, demonstrations, trials, training, support and any related offering, in each case whether provided free of charge or for a fee.</p>
        <p>"You", "your", "User" means any person or entity that accesses or uses the Services in any capacity, including as a customer, authorised user, administrator, evaluator, trial user, invitee, guest or visitor, and includes the organisation on whose behalf such person acts.</p>
        <p>"Output" means any report, calculation, total, sub-total, rate, quantity, valuation, variance, forecast, scenario, summary, classification, recommendation, register, tracker, status indicator, document, export or other result generated, computed, aggregated, derived or displayed by the Services.</p>
        <p>This Disclaimer applies to all Services, to all Output, and to every User, and applies in addition to and not in substitution for the Company's Terms and Conditions, Privacy Policy and any order form, subscription agreement or master services agreement. Where an executed written agreement signed by an authorised signatory of the Company expressly conflicts with this Disclaimer, that agreement prevails only to the extent of the express conflict, and every other provision of this Disclaimer continues in full force.</p>
      </section>

      <section>
        <h2>2. Business use only — the Services are not offered to consumers</h2>
        <p>The Services are offered exclusively for business, commercial, professional and organisational use. They are not designed, marketed, priced or offered for personal, household or domestic use, and are not offered to any person acting as a consumer.</p>
        <p>By accessing or using the Services you represent and warrant that you are doing so exclusively for business or commercial purposes, in the course of a trade, profession, undertaking or business, and not as a consumer. You agree that you will not assert or rely upon any right, remedy, presumption or protection available only to consumers in connection with the Services.</p>
      </section>

      <section>
        <h2>3. Acknowledgement, assumption of risk and non-reliance</h2>
        <p>You acknowledge, represent and agree that:</p>
        <p>You have read and understood this Disclaimer in full, have had the opportunity to take independent legal advice on it, and accept it voluntarily.</p>
        <p>You possess, or have engaged persons who possess, the skill, competence, qualification and experience required to evaluate, configure, operate and verify the Services and the Output for your intended purposes.</p>
        <p>You have satisfied yourself, by your own independent investigation and testing, that the Services are suitable for your requirements, and you do not rely on any statement, representation, assurance, demonstration, projection, proposal, presentation, roadmap or warranty (whether made innocently or negligently, and whether oral or written) which is not expressly set out in an executed written agreement signed by an authorised signatory of the Company.</p>
        <p>You assume full and exclusive responsibility for the selection of the Services, for their use, for the data you supply to them, for their configuration, and for all decisions, actions and omissions of yours arising from or informed by the Services or the Output.</p>
        <p>The allocation of risk in this Disclaimer is a fundamental basis on which the Company agrees to make the Services available, is reflected in the pricing of the Services, and is reasonable in the circumstances. The Company would not make the Services available on any other basis.</p>
        <p>You shall have no remedy in respect of any untrue statement made to you upon which you relied in deciding to use the Services, and your only remedies in respect of any statement that is expressly set out in an executed written agreement are those expressly provided in that agreement. Nothing in this clause limits liability for fraud or fraudulent misrepresentation.</p>
      </section>

      <section>
        <h2>4. Information only — no professional advice of any kind</h2>
        <p>The Services and all Output are provided solely for general business information, record-keeping and internal operational management purposes.</p>
        <p>Nothing made available through the Services constitutes or is intended to constitute:</p>
        <p>legal advice, or any opinion on the application, interpretation, validity or effect of any law, rule, regulation, notification, circular or judgment;</p>
        <p>tax advice, or any opinion on any tax position, liability, rate, classification, exemption, credit, return or filing;</p>
        <p>accounting, audit, assurance or company secretarial advice, or certification of any account, record, register or financial statement;</p>
        <p>financial, investment, valuation, credit, insurance or commercial advice;</p>
        <p>statutory, regulatory or compliance certification, attestation, assurance or sign-off of any kind;</p>
        <p>engineering, architectural, quantity surveying, structural, safety, environmental or construction advice; or</p>
        <p>professional advice of any other description whatsoever.</p>
        <p>The Company is a software provider. It is not a law firm, chartered accountancy firm, cost accountancy firm, company secretarial practice, audit firm, registered valuer, licensed engineer, architect, insurance intermediary or regulated financial adviser, does not hold itself out as any of these, and is not registered, licensed or authorised to practise any such profession. No advisory, fiduciary, professional-client, agency, partnership, joint venture or employment relationship arises between you and the Company by reason of your use of the Services.</p>
        <p>YOU MUST OBTAIN INDEPENDENT ADVICE FROM A SUITABLY QUALIFIED AND, WHERE APPLICABLE, LICENSED PROFESSIONAL BEFORE ACTING ON ANY OUTPUT. You alone remain responsible for every decision you take and for every filing, return, submission, certificate, contract, tender, bid, invoice, payment, disclosure or representation you make.</p>
      </section>

      <section>
        <h2>5. Accuracy of Output — verification is exclusively your responsibility</h2>
        <p>The Services may generate, compute, aggregate, estimate, model, convert, import, export or reproduce figures and documents, including without limitation bills of quantities, rates, quantities, cost and variance analyses, budgets, forecasts, scenario and what-if models, valuations, invoices, payroll figures, statutory deductions, tax computations, registers, compliance trackers and management reports.</p>
        <p>You acknowledge and agree that:</p>
        <p>Output is generated from data supplied, imported, configured or transmitted by you, your personnel, your affiliates or third parties, and its correctness is wholly dependent on the accuracy, completeness, currency, formatting and appropriateness of that input data.</p>
        <p>The Company does not audit, validate, reconcile, verify or assume any responsibility for any data entered into, imported into, stored in or transmitted through the Services.</p>
        <p>Software may contain errors, defects, bugs, regressions and limitations. Calculations, rounding conventions, unit conversions, currency treatment, tax mappings, chart-of-account mappings, templates, rules and configurations may be inappropriate or incorrect for your particular circumstances.</p>
        <p><strong>ALL OUTPUT MUST BE INDEPENDENTLY REVIEWED, TESTED AND VERIFIED BY A COMPETENT PERSON BEFORE IT IS RELIED UPON, ACTED UPON, ISSUED TO ANY THIRD PARTY, INCORPORATED INTO ANY CONTRACT, TENDER OR CERTIFICATE, OR SUBMITTED TO ANY AUTHORITY.</strong></p>
        <p>Output is not, and must not be treated as, your books of account, your statutory records, or a substitute for professional review, internal control or independent reconciliation.</p>
        <p>Your failure to carry out such independent verification shall be treated as the sole proximate cause of any loss arising from reliance on incorrect Output.</p>
        <p>Figures, sample data, demonstration environments, screenshots, benchmarks and illustrative outputs shown in marketing material, proposals, demonstrations or documentation are illustrative only, are frequently synthetic, and do not represent actual, typical or guaranteed results.</p>
      </section>

      <section>
        <h2>6. Artificial intelligence and automated processing</h2>
        <p>Certain features of the Services use artificial intelligence, machine learning, large language models, generative models, automated reasoning, heuristics or algorithmic processing, including models, systems and services designed, trained, hosted or operated by third parties over which the Company exercises no control.</p>
        <p>You acknowledge and agree that:</p>
        <p>AI-generated Output is probabilistic and not deterministic. It may be incomplete, outdated, internally inconsistent, misleading or factually incorrect, and may state incorrect matter in fluent and confident terms.</p>
        <p>AI features may misread, misinterpret or misclassify instructions, context, documents, images or data, and may omit material information.</p>
        <p>Identical or materially similar inputs may produce materially different Output at different times, and Output is not reproducible.</p>
        <p>AI features are decision-support tools only. They do not exercise judgment, do not make decisions for you, and are not a substitute for human professional review. Every AI-generated Output must be reviewed by a competent human before being relied upon, published, acted upon, transmitted or submitted.</p>
        <p>The Company gives no warranty as to the accuracy, completeness, reliability, reproducibility, non-infringement or fitness for purpose of any AI-generated Output, and does not warrant the continued availability, version, behaviour, pricing or performance of any third-party model or service.</p>
        <p>Where the Services automate a workflow, the automation executes rules, thresholds, approvals and data that you or your personnel configure. You are solely responsible for that configuration and for all consequences of the automated action, including actions taken without contemporaneous human review.</p>
      </section>

      <section>
        <h2>7. Regulatory, statutory and compliance content</h2>
        <p>Certain Products, features, templates, checklists, registers, calendars or trackers may refer to statutes, rules, regulations, standards, notifications, circulars, forms, formats, rates, thresholds, filings or due dates, including those relating to data protection, corporate law, taxation, labour law and sector-specific regulation.</p>
        <p>You acknowledge and agree that:</p>
        <p>Law changes frequently, is amended and brought into force on varying and sometimes retrospective timelines, and is interpreted differently by different authorities, benches and courts.</p>
        <p>The Company makes no representation or warranty that any such content is current, complete, accurate, authoritative or applicable to your entity type, sector, state, turnover, period or circumstances.</p>
        <p>USE OF THE SERVICES DOES NOT MAKE YOU COMPLIANT WITH ANY LAW. The Company does not certify, guarantee, warrant, underwrite or insure your compliance with any statutory, regulatory or contractual obligation.</p>
        <p>A compliance tracker, checklist, score, dashboard or status indicator within the Services is an internal management aid only. It is not a legal determination, not evidence of compliance, not an audit, and not a defence before any authority, court or tribunal.</p>
        <p>You remain solely responsible for identifying, interpreting and discharging your own obligations and for engaging qualified professionals to advise you.</p>
        <p>The Company shall bear no liability whatsoever for any penalty, interest, late fee, demand, assessment, prosecution, disqualification, licence action or other consequence imposed on you or any person by any authority.</p>
      </section>

      <section>
        <h2>8. Services provided "as is" — exclusion of warranties</h2>
        <p><strong>TO THE MAXIMUM EXTENT PERMITTED BY APPLICABLE LAW, THE SERVICES AND ALL OUTPUT ARE PROVIDED "AS IS", "WITH ALL FAULTS" AND "AS AVAILABLE", WITHOUT WARRANTY, REPRESENTATION, CONDITION, UNDERTAKING, TERM OR GUARANTEE OF ANY KIND, WHETHER EXPRESS, IMPLIED, STATUTORY, COLLATERAL OR ARISING FROM COURSE OF DEALING, COURSE OF PERFORMANCE OR USAGE OF TRADE, ALL OF WHICH ARE EXPRESSLY EXCLUDED.</strong></p>
        <p>Without limiting the generality of the foregoing, the Company expressly disclaims all implied warranties and conditions of merchantability, satisfactory quality, fitness for a particular purpose, accuracy, completeness, timeliness, interoperability, workmanlike effort, quiet enjoyment, title and non-infringement.</p>
        <p>The Company does not warrant that: the Services will be uninterrupted, timely, secure, complete or error-free; that defects will be identified or corrected within any period or at all; that the Services or supporting infrastructure are free of viruses, malicious code or vulnerabilities; that the Services will meet your requirements or achieve any particular result, saving, efficiency, return or outcome; that any data or Output will be accurate, complete, current or preserved; or that the Services will operate with any particular hardware, operating system, browser, device, network or third-party software.</p>
        <p>No advice or information, whether oral or written, obtained from the Company, from any employee or agent of the Company, or through the Services, creates any warranty not expressly stated in an executed written agreement signed by an authorised signatory of the Company.</p>
      </section>

      <section>
        <h2>9. Development, beta, evaluation and demonstration use</h2>
        <p>Products, modules or features may be made available on a pre-release, alpha, beta, trial, pilot, evaluation, proof-of-concept, free-tier or demonstration basis ("Evaluation Offerings").</p>
        <p>Evaluation Offerings are provided solely for evaluation, may be incomplete, unstable or withdrawn without notice, carry no availability, performance, support, security, data-retention or backward-compatibility commitment whatsoever, and may have data deleted, reset, overwritten or migrated at any time without notice or liability.</p>
        <p>EVALUATION OFFERINGS MUST NOT BE USED FOR PRODUCTION DATA, LIVE BUSINESS OPERATIONS, STATUTORY RECORDS, OR ANY PURPOSE WHERE FAILURE, UNAVAILABILITY, DATA LOSS OR INACCURACY COULD CAUSE LOSS, HARM OR LIABILITY. Any such use is entirely at your own risk, and the Company shall have no liability of any kind in respect of Evaluation Offerings.</p>
      </section>

      <section>
        <h2>10. Not for high-risk or safety-critical use</h2>
        <p>The Services are not designed, tested, certified or intended for use in any environment or application requiring fail-safe performance, or in which failure, delay, error or inaccuracy could lead to death, personal injury, structural failure, environmental damage, or severe physical, financial or systemic harm. You shall not use the Services for any such purpose, and the Company expressly disclaims all warranty and liability in respect of any such use.</p>
      </section>

      <section>
        <h2>11. Availability, third-party infrastructure and dependencies</h2>
        <p>The Services depend on third-party infrastructure, hosting, compute, storage, database, network, content-delivery, authentication, payment, messaging, analytics and artificial-intelligence providers, and on the public internet, none of which is owned or controlled by the Company.</p>
        <p>The Company is not responsible for the availability, performance, security, pricing, terms, continuity or acts and omissions of any third-party provider or network. Any interruption, degradation, suspension, throttling, deprecation, data loss, breach or change of terms originating with a third party is outside the Company's control and shall not constitute a breach by the Company.</p>
        <p>The Company may, at its sole discretion and without liability, perform scheduled or emergency maintenance, and may modify, update, suspend, limit, withdraw or discontinue any feature, module, integration or the whole of the Services. Unless an executed written agreement expressly states otherwise, the Company gives no service level, uptime, latency, throughput, recovery-point or recovery-time commitment, and no credit or remedy arises from unavailability.</p>
      </section>

      <section>
        <h2>12. Third-party, open-source and publicly available materials</h2>
        <p>The Services have been, and continue to be, developed with reference to publicly and lawfully available information, including without limitation technical documentation, published standards and specifications, government-published forms, formats, schemas and taxonomies, statutory and regulatory texts, public-domain materials, academic and industry literature, publicly accessible websites, and publicly available open-source projects and their documentation.</p>
        <p>You acknowledge and agree that:</p>
        <p>Facts, data, ideas, concepts, principles, methods of operation, procedures, processes, systems, functional requirements, industry practice, terminology, and structures dictated by function, interoperability or by statutory or regulatory form are not, of themselves, the subject of copyright protection. The Company's independent design and implementation of any such subject matter does not create, imply or evidence any affiliation with, derivation from, endorsement by, sponsorship by, or licence from any third party.</p>
        <p>Where third-party or open-source software, libraries, frameworks, components, models or datasets are incorporated into or distributed with the Services, each such component remains the property of, and is licensed by, its respective owner under its own licence terms, and is subject to the disclaimers, limitations and exclusions of that owner and licence. The Company gives no warranty, indemnity or representation of any kind in respect of any third-party or open-source component.</p>
        <p>Applicable third-party and open-source licence notices, to the extent the Company is required to make them available, may be obtained by written request to the Company at the address stated in this Disclaimer.</p>
        <p>Third-party names, marks, logos, product names and specification references appearing in the Services or documentation are used solely for identification, compatibility, interoperability and descriptive purposes. All such marks remain the property of their respective owners, and no affiliation, endorsement or sponsorship is claimed or implied.</p>
        <p>References to publicly available information within the Services are provided for convenience only. The Company does not warrant the accuracy, completeness, currency, lawfulness or availability of any external source, and is not responsible for any external content, website or resource.</p>
        <p>Notice of claimed infringement. If you are a rights owner and believe that any part of the Services infringes your intellectual property rights, you may notify the Company in writing at the address stated in this Disclaimer, identifying yourself and your right, identifying the material complained of with sufficient particularity to enable it to be located, and stating the basis of your claim. The Company will review any properly particularised notice in good faith and within a reasonable time, and may in its discretion remove, disable, modify or replace the material complained of. Such review, and any action taken, is undertaken without any admission of liability, infringement or wrongdoing of any kind, and is without prejudice to the Company's rights and defences, all of which are expressly reserved.</p>
      </section>

      <section>
        <h2>13. Third-party content, links and integrations</h2>
        <p>The Services may display content supplied by third parties, link to external websites, or integrate with third-party applications, marketplaces and services. These are not under the Company's control. The Company does not endorse, monitor, screen, verify or accept any responsibility for them, for their content, accuracy, legality, pricing, availability or security, or for any transaction, dealing or correspondence between you and any third party. Your use of any third-party website, application or service is governed by that third party's own terms and is entirely at your own risk.</p>
      </section>

      <section>
        <h2>14. Your data, your users and security</h2>
        <p>You are solely responsible for all data, documents, records, content and personal information that you or your personnel enter into, upload to, generate within or transmit through the Services, including for its legality, accuracy, quality and appropriateness, and for holding all rights, consents, notices, authorisations and lawful bases necessary to supply it and to have it processed.</p>
        <p>You are solely responsible for the confidentiality and security of access credentials, for the acts and omissions of every person who accesses the Services using your credentials or within your tenancy, for the correct configuration of organisations, roles, permissions, visibility settings and approvals, for the appropriateness of those settings to your circumstances, and for maintaining your own independent, tested backups of all business-critical data.</p>
        <p>The Company applies measures it considers reasonable to protect the Services. However, no method of transmission, processing or storage is completely secure, and the Company does not warrant that the Services cannot be compromised, intercepted or accessed without authorisation. The Company shall not be liable for any unauthorised access, disclosure, alteration or loss arising from your acts or omissions, from compromised credentials, from your configuration, from your personnel, or from any third party. Processing of personal data is addressed in the Company's Privacy Policy.</p>
      </section>

      <section>
        <h2>15. Sole remedy, limitation of liability and cap</h2>
        <p>Sole and exclusive remedy. Your sole and exclusive remedy for dissatisfaction with, or any defect, error or failure in, the Services is to cease using the Services and, where applicable, to terminate your subscription in accordance with its terms.</p>
        <p><strong>TO THE MAXIMUM EXTENT PERMITTED BY APPLICABLE LAW, THE COMPANY SHALL NOT BE LIABLE, WHETHER IN CONTRACT, TORT (INCLUDING NEGLIGENCE), BREACH OF STATUTORY DUTY, MISREPRESENTATION, RESTITUTION OR OTHERWISE, FOR ANY:</strong></p>
        <p>indirect, incidental, special, consequential, exemplary or punitive loss or damage;</p>
        <p>loss of profit, revenue, turnover, business, contract, customer, anticipated saving or opportunity, whether direct or indirect;</p>
        <p>loss of or damage to goodwill or reputation;</p>
        <p>loss, corruption, destruction or unavailability of data, records or software;</p>
        <p>business interruption, wasted expenditure, wasted management time or cost of procuring substitute goods or services;</p>
        <p>penalty, interest, late fee, demand, assessment, disallowance, prosecution or other consequence imposed by any authority; or</p>
        <p>loss arising from any filing, return, certificate, valuation, contract, tender, invoice, payment or representation made by you or by any person relying on Output,</p>
        <p>in each case however arising and whether or not the Company was advised of, or could have foreseen, the possibility of such loss.</p>
        <p>Aggregate cap. Where liability cannot lawfully be excluded, the Company's total aggregate liability arising out of or in connection with the Services, this Disclaimer, and all claims taken together (whether one claim or a series of connected claims), shall not exceed the total fees actually received by the Company from you in respect of the specific Product giving rise to the claim during the three (3) months immediately preceding the first event giving rise to the claim. Where no fees have been received, the Company shall have no liability whatsoever.</p>
        <p>Aggregation. All claims arising from a common cause, a series of related causes, or a continuing state of affairs shall be treated as a single claim arising on the date of the first such event.</p>
        <p>Claims against individuals. You agree to bring any claim solely against the Company, and not against any director, officer, employee, contractor, agent, licensor or supplier of the Company in their personal capacity. Each such person may rely on and enforce this clause.</p>
        <p>Notice of claims. You shall notify the Company in writing of any claim as soon as reasonably practicable after you become aware, or ought reasonably to have become aware, of the circumstances giving rise to it, and in any event promptly enough to permit the Company to investigate and mitigate. Failure to do so shall relieve the Company of liability to the extent it is prejudiced thereby.</p>
        <p>Nothing in this Disclaimer excludes or limits any liability which cannot lawfully be excluded or limited, including liability for fraud or fraudulent misrepresentation. If any exclusion or limitation is held unenforceable, the remaining exclusions and limitations shall continue to apply to the fullest extent permitted.</p>
      </section>

      <section>
        <h2>16. Indemnity</h2>
        <p>You shall indemnify, defend and hold harmless the Company and each of its directors, officers, employees, contractors, agents, licensors and suppliers from and against any and all claims, demands, actions, proceedings, investigations, losses, liabilities, damages, awards, settlements, fines, penalties, costs and expenses (including reasonable legal fees on a full indemnity basis) arising out of or in connection with:</p>
        <p>your access to or use of, or inability to use, the Services or any Output;</p>
        <p>any breach by you of this Disclaimer, the Terms and Conditions, any executed agreement, or any applicable law;</p>
        <p>any data, document, content or personal information supplied by you or by your personnel, including any claim that it infringes any right or was supplied without a lawful basis or necessary consent;</p>
        <p>your configuration of the Services, including roles, permissions, visibility, approvals and automations;</p>
        <p>any reliance placed on Output by you, by your personnel, or by any third party to whom you make Output available, directly or indirectly; and</p>
        <p>any claim brought by any customer, client, employee, contractor, counterparty, auditor or authority of yours in connection with the Services or Output.</p>
        <p>The Company shall have the right, at your cost, to assume the exclusive defence and control of any matter subject to indemnification by you, and you shall not settle any such matter without the Company's prior written consent.</p>
      </section>

      <section>
        <h2>17. Suspension and termination</h2>
        <p>The Company may, at its sole discretion and without liability, suspend, restrict or terminate your access to the Services, in whole or in part, immediately and without prior notice, where the Company reasonably considers that: you are in breach of this Disclaimer, the Terms and Conditions or any applicable law; your use threatens the security, integrity, availability or lawful operation of the Services; fees are overdue; or suspension is required by law, by a competent authority, or by a third-party provider. The Company shall have no liability for any loss arising from such suspension, restriction or termination.</p>
      </section>

      <section>
        <h2>18. Intellectual property, trademarks and reservation of rights</h2>
        <p>The Platform, the Products and all associated software, source code, object code, architecture, database design, schemas, interfaces, documentation, designs, text, graphics and branding, and all intellectual property rights therein, are and shall remain the exclusive property of the Company or its licensors. No right, title, interest, licence or permission is granted to you save as expressly set out in an executed written agreement, and all rights not expressly granted are reserved.</p>
        <p>VERIDIAN AI OS, PROJEXA, VERIDIAN-AIOS, and all associated names, logos, domain names and marks are marks of the Company, whether registered or unregistered. All other product names, logos, marks and brands appearing in or in connection with the Services are the property of their respective owners and are used for identification and descriptive purposes only, without any claim of affiliation, endorsement or sponsorship.</p>
        <p>You shall not copy, reproduce, modify, adapt, translate, reverse engineer, decompile, disassemble, scrape, benchmark for publication, create derivative works from, or attempt to derive the source code, structure or logic of the Services, except to the extent such restriction is expressly prohibited by applicable law.</p>
      </section>

      <section>
        <h2>19. No offer, solicitation or forward-looking commitment</h2>
        <p>Nothing in the Services, on the Company's websites, or in any marketing, investor or partner material constitutes an offer, invitation, inducement or solicitation to invest in, subscribe for or acquire any security or interest in the Company, or an offer to provide services in any jurisdiction where such an offer would be unlawful or would require registration the Company does not hold.</p>
        <p>Any statement regarding future functionality, roadmap, release timing, capacity, performance, pricing or results is forward-looking and indicative only, is subject to change without notice, does not form part of any contract, and must not be relied upon in making any purchasing, investment or planning decision. The Company undertakes no obligation to update any such statement.</p>
      </section>

      <section>
        <h2>20. Force majeure</h2>
        <p>The Company shall not be liable for any delay in performing, or failure to perform, any obligation, or for any unavailability, degradation or loss, caused by any circumstance beyond its reasonable control, including act of God, flood, fire, earthquake, epidemic or pandemic, war, terrorism, riot, civil commotion, strike or labour dispute, act or omission of government or regulator, change in law, failure or unavailability of internet, telecommunications, power, cloud, hosting or third-party services, cyber-attack, denial-of-service attack, malware, or failure of any supplier or subcontractor.</p>
      </section>

      <section>
        <h2>21. Governing law, dispute resolution and jurisdiction</h2>
        <p>This Disclaimer, and any dispute, claim or obligation (whether contractual or non-contractual) arising out of or in connection with it, its subject matter or its formation, shall be governed by and construed in accordance with the laws of India, without regard to conflict-of-laws principles.</p>
        <p>The parties shall first attempt in good faith to resolve any dispute by negotiation between senior representatives within thirty (30) days of written notice of the dispute. Any dispute not so resolved shall be referred to and finally resolved by arbitration under the Arbitration and Conciliation Act, 1996, by a sole arbitrator appointed by the Company, with the seat and venue of arbitration at Ghaziabad, Uttar Pradesh, India, and the language of the arbitration being English. The arbitral award shall be final and binding. Each party shall bear its own costs unless the arbitrator directs otherwise.</p>
        <p>Subject to the foregoing, the courts at Ghaziabad, Uttar Pradesh, India shall have exclusive jurisdiction. Nothing in this clause prevents the Company from seeking urgent injunctive or other interim relief from any court of competent jurisdiction.</p>
        <p>Any claim must be brought in your individual or organisational capacity. You waive any right to participate in any class, collective, consolidated or representative proceeding against the Company, to the extent permitted by applicable law.</p>
      </section>

      <section>
        <h2>22. General</h2>
        <p>Entire agreement. This Disclaimer, together with the Terms and Conditions, the Privacy Policy and any executed agreement, constitutes the entire agreement between you and the Company in relation to its subject matter, and supersedes all prior discussions, proposals, presentations, demonstrations, representations, understandings and arrangements, whether oral or written.</p>
        <p>Amendment. The Company may amend this Disclaimer at any time by publishing an updated version, which takes effect on publication unless stated otherwise. The current published version is the operative version. Your continued access to or use of the Services after publication constitutes acceptance of the amended Disclaimer. It is your responsibility to review the current version periodically.</p>
        <p>Severability. If any provision is held invalid, illegal or unenforceable, it shall be modified to the minimum extent necessary to render it enforceable, or severed if modification is not possible, and the remaining provisions shall continue in full force and effect.</p>
        <p>No waiver. No failure or delay by the Company in exercising any right or remedy constitutes a waiver of it, and no single or partial exercise precludes any further exercise.</p>
        <p>Assignment. You may not assign, novate or transfer any right or obligation without the Company's prior written consent. The Company may assign, novate or transfer freely, including on a merger, reorganisation or sale of business or assets.</p>
        <p>Survival. Clauses 1 to 8, 10, 12, 14 to 16, 18, 21 and 22 survive any expiry, suspension or termination.</p>
        <p>No third-party rights. Save as expressly stated in clause 15 in respect of the Company's directors, officers, employees, contractors, agents, licensors and suppliers, no person other than you and the Company has any right to enforce this Disclaimer.</p>
        <p>Headings and interpretation. Headings are for convenience only and do not affect interpretation. "Including" and "in particular" are without limitation. This Disclaimer shall not be construed against the Company by reason of it having drafted it.</p>
        <p>Language. This Disclaimer is drafted in English. Any translation is provided for convenience only, and the English version prevails.</p>
      </section>

      <section>
        <h2>23. Contact</h2>
        <p>All notices, requests, licence enquiries and notices of claimed infringement under this Disclaimer should be sent in writing to:</p>
        <p><strong>SHOBHA KAMAL SOLUTIONS PRIVATE LIMITED</strong></p>
        <p>CIN: U74999UP2017PTC098453</p>
        <p>B-1105, Plot No. 14, Shipra Krishna Vista, Ahinsa Khand-1, Indirapuram, Ghaziabad, Uttar Pradesh 201014, India</p>
        <p>Email: [INSERT CONTACT EMAIL]</p>
      </section>
        </div>
      </article>
      <MarketingFooter locale="en" />
    </div>
  );
}
