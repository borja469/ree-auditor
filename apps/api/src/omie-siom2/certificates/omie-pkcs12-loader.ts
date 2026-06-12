import * as forge from "node-forge";

export type OmiePkcs12CertificateInfo = {
  index: number;
  subject: string;
  issuer: string;
  serialNumber: string;
  notBefore: string;
  notAfter: string;
  isCa: boolean;
  isSelfSigned: boolean;
  matchesPrivateKey: boolean;
  selectedForTls: boolean;
};

export type OmiePkcs12Identity = {
  privateKeyPem: string;
  certificatePem: string;
  caPem: string[];
  selectedCertificate: OmiePkcs12CertificateInfo;
  certificates: OmiePkcs12CertificateInfo[];
};

type CertificateBagWithCert = forge.pkcs12.Bag & {
  cert: forge.pki.Certificate;
};

type PrivateKeyBagWithKey = forge.pkcs12.Bag & {
  key: forge.pki.rsa.PrivateKey;
};

export function loadOmiePkcs12Identity(p12Buffer: Buffer, passphrase: string): OmiePkcs12Identity {
  const p12Asn1 = forge.asn1.fromDer(p12Buffer.toString("binary"));
  const p12 = forge.pkcs12.pkcs12FromAsn1(p12Asn1, false, passphrase);
  const privateKeyBag = findPrivateKeyBag(p12);

  if (!privateKeyBag) {
    throw new Error("PKCS12 does not contain a private key.");
  }

  const certificateBags = findCertificateBags(p12);
  if (certificateBags.length === 0) {
    throw new Error("PKCS12 does not contain X509 certificates.");
  }

  const selectedCertificateBag = selectCertificateBag(certificateBags, privateKeyBag);
  if (!selectedCertificateBag) {
    throw new Error("PKCS12 does not contain a certificate matching the private key.");
  }

  const selectedIndex = certificateBags.indexOf(selectedCertificateBag);
  const certificates = certificateBags.map((bag, index) =>
    buildCertificateInfo(bag.cert, index, bag === selectedCertificateBag, certificateMatchesPrivateKey(bag, privateKeyBag))
  );
  const caPem = certificateBags.filter((bag) => bag !== selectedCertificateBag).map((bag) => forge.pki.certificateToPem(bag.cert));

  return {
    privateKeyPem: forge.pki.privateKeyToPem(privateKeyBag.key),
    certificatePem: forge.pki.certificateToPem(selectedCertificateBag.cert),
    caPem,
    selectedCertificate: certificates[selectedIndex],
    certificates
  };
}

function findPrivateKeyBag(p12: forge.pkcs12.Pkcs12Pfx): PrivateKeyBagWithKey | undefined {
  return (
    bagsByType(p12, forge.pki.oids.pkcs8ShroudedKeyBag).find(hasPrivateKey) ??
    bagsByType(p12, forge.pki.oids.keyBag).find(hasPrivateKey)
  );
}

function findCertificateBags(p12: forge.pkcs12.Pkcs12Pfx): CertificateBagWithCert[] {
  return bagsByType(p12, forge.pki.oids.certBag).filter(hasCertificate);
}

function selectCertificateBag(certificateBags: CertificateBagWithCert[], privateKeyBag: PrivateKeyBagWithKey) {
  const matchingByLocalKeyId = certificateBags.find((bag) => localKeyIdOf(bag) && localKeyIdOf(bag) === localKeyIdOf(privateKeyBag));
  if (matchingByLocalKeyId) {
    return matchingByLocalKeyId;
  }

  const matchingByPublicKey = certificateBags.find((bag) => certificateMatchesPrivateKey(bag, privateKeyBag));
  if (matchingByPublicKey) {
    return matchingByPublicKey;
  }

  const nonCaCertificates = certificateBags.filter((bag) => !isCaCertificate(bag.cert));
  return nonCaCertificates.length === 1 ? nonCaCertificates[0] : undefined;
}

function bagsByType(p12: forge.pkcs12.Pkcs12Pfx, bagType: string) {
  return p12.getBags({ bagType })[bagType] ?? [];
}

function hasPrivateKey(bag: forge.pkcs12.Bag): bag is PrivateKeyBagWithKey {
  return Boolean(bag.key);
}

function hasCertificate(bag: forge.pkcs12.Bag): bag is CertificateBagWithCert {
  return Boolean(bag.cert);
}

function certificateMatchesPrivateKey(certificateBag: CertificateBagWithCert, privateKeyBag: PrivateKeyBagWithKey) {
  const publicKey = certificateBag.cert.publicKey as forge.pki.rsa.PublicKey;
  const privateKey = privateKeyBag.key;
  return publicKey.n?.equals(privateKey.n) === true && publicKey.e?.equals(privateKey.e) === true;
}

function buildCertificateInfo(cert: forge.pki.Certificate, index: number, selectedForTls: boolean, matchesPrivateKey: boolean): OmiePkcs12CertificateInfo {
  return {
    index,
    subject: formatCertificateName(cert.subject.attributes),
    issuer: formatCertificateName(cert.issuer.attributes),
    serialNumber: cert.serialNumber,
    notBefore: cert.validity.notBefore.toISOString(),
    notAfter: cert.validity.notAfter.toISOString(),
    isCa: isCaCertificate(cert),
    isSelfSigned: isSelfSigned(cert),
    matchesPrivateKey,
    selectedForTls
  };
}

export function formatCertificateName(attributes: forge.pki.CertificateField[]) {
  return attributes.map((attribute) => `${attribute.shortName ?? attribute.name ?? attribute.type}=${formatCertificateValue(attribute.value)}`).join(", ");
}

function formatCertificateValue(value: unknown) {
  return Array.isArray(value) ? value.map((entry) => String(entry)).join("/") : String(value ?? "");
}

function isCaCertificate(cert: forge.pki.Certificate) {
  const basicConstraints = cert.getExtension("basicConstraints") as { cA?: boolean } | undefined;
  return basicConstraints?.cA === true;
}

function isSelfSigned(cert: forge.pki.Certificate) {
  return cert.subject.hash === cert.issuer.hash;
}

function localKeyIdOf(bag: forge.pkcs12.Bag) {
  const values = bag.attributes?.localKeyId;
  return Array.isArray(values) ? values[0] : undefined;
}
