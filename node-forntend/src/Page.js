// src/Page.js
import React, { useEffect, useState, useRef } from 'react';
import { useTranslation } from 'react-i18next';

// Globaler Cache für SVGs: speichert entweder den Promise oder den fertigen SVG-Text
const svgCache = {};

// Helper-Funktion: Liefert den SVG-Text oder den laufenden Promise, falls bereits ein Fetch läuft.
const fetchSvg = (svgFile) => {
  // Falls schon etwas im Cache ist:
  if (svgCache[svgFile]) {
    // Falls es sich um einen Promise handelt, diesen zurückgeben
    if (typeof svgCache[svgFile].then === 'function') {
      return svgCache[svgFile];
    }
    // Andernfalls gibt es den fertigen Text zurück
    return Promise.resolve(svgCache[svgFile]);
  }
  // Andernfalls: Starte den Fetch und speichere den Promise im Cache
  const promise = fetch(svgFile)
    .then(response => {
      if (!response.ok) {
        throw new Error(`SVG ${svgFile} nicht gefunden.`);
      }
      return response.text();
    })
    .then(text => {
      svgCache[svgFile] = text; // Text im Cache speichern
      console.log(`Loaded: ${svgFile}`);
      return text;
    })
    .catch(err => {
      console.error('Fehler beim Laden des SVG:', err);
      throw err;
    });
  svgCache[svgFile] = promise; // Speichere zunächst den Promise
  return promise;
};

const Page = ({ svg: currentSvg, properties, allSvgs = [] }) => {
  const { t } = useTranslation();
  const currentSvgFile = `/assets/${currentSvg}.svg`;
  const [svgContent, setSvgContent] = useState('');
  const containerRef = useRef(null);

  // Preload aller definierten SVGs (läuft beim Mounten der Seite)
  useEffect(() => {
    allSvgs.forEach(svgName => {
      const svgFile = `/assets/${svgName}.svg`;
      // Starte fetchSvg, falls noch nicht im Cache
      fetchSvg(svgFile).catch(() => {
        // Fehler bereits geloggt
      });
    });
  }, [allSvgs]);

  // Lade das aktuell benötigte SVG (nutzt den Cache und den Promise)
  useEffect(() => {
    fetchSvg(currentSvgFile)
      .then(text => setSvgContent(text))
      .catch(() => {
        // Fehler bereits geloggt
      });
  }, [currentSvgFile]);

  // Verarbeite den geladenen SVG-Inhalt: Ersetze Platzhalter und passe Attribute an
  useEffect(() => {
    if (svgContent && containerRef.current) {
      let processedSvg = svgContent.replace(/{{(.*?)}}/g, (match, p1) => t(p1.trim()));

      const parser = new DOMParser();
      const xmlDoc = parser.parseFromString(processedSvg, 'image/svg+xml');

      // Falls vorhanden: Verarbeite ycontrol-Einträge
      const ycontrol = xmlDoc.querySelector('ycontrol');
      if (ycontrol) {
        const propertyElements = ycontrol.querySelectorAll('property');
        propertyElements.forEach(propEl => {
          const propName = propEl.getAttribute('name');
          const value = properties?.[propName]?.toString() ?? propEl.getAttribute('defaultvalue');
          const targets = propEl.querySelectorAll('target');
          targets.forEach(target => {
            const targetType = target.getAttribute('type');
            const targetElementName = target.getAttribute('element');
            let outputValue = null;
            const conditions = target.querySelectorAll('condition');
            if (conditions.length > 0) {
              for (const cond of conditions) {
                if (cond.hasAttribute('eq') && cond.getAttribute('eq') === value) {
                  outputValue = cond.getAttribute('output');
                  break;
                } else if (cond.hasAttribute('lt') && Number(value) < Number(cond.getAttribute('lt'))) {
                  outputValue = cond.getAttribute('output');
                  break;
                } else if (cond.hasAttribute('gt') && Number(value) > Number(cond.getAttribute('gt'))) {
                  outputValue = cond.getAttribute('output');
                  break;
                } else if (cond.hasAttribute('lte') && Number(value) <= Number(cond.getAttribute('lte'))) {
                  outputValue = cond.getAttribute('output');
                  break;
                } else if (cond.hasAttribute('gte') && Number(value) >= Number(cond.getAttribute('gte'))) {
                  outputValue = cond.getAttribute('output');
                  break;
                }
              }
            } else {
              outputValue = value;
            }
            if (outputValue !== null) {
              const elementsToUpdate = xmlDoc.querySelectorAll(`.${targetElementName}`);
              if (targetType === 'Style') {
                const selector = target.getAttribute('selector');
                elementsToUpdate.forEach(el => (el.style[selector] = outputValue));
              } else if (targetType === 'Content') {
                elementsToUpdate.forEach(el => {
                  const tspan = el.querySelector('tspan');
                  (tspan || el).textContent = outputValue;
                });
              }
            }
          });
        });
      }

      // Sicherstellen, dass das SVG den gesamten Container ausfüllt
      const svgEl = xmlDoc.querySelector('svg');
      if (svgEl) {
        if (!svgEl.getAttribute('viewBox')) {
          svgEl.setAttribute('viewBox', '0 0 1024 423');
        }
        svgEl.removeAttribute('width');
        svgEl.removeAttribute('height');
        svgEl.setAttribute('width', '100%');
        svgEl.setAttribute('height', '100%');
        svgEl.setAttribute('preserveAspectRatio', 'xMidYMid meet');
        svgEl.style.width = '100%';
        svgEl.style.height = '100%';
      }

      containerRef.current.innerHTML = new XMLSerializer().serializeToString(xmlDoc);
    }
  }, [svgContent, properties, t]);

  return <div style={{ width: '100%', height: '100%', overflow: 'hidden' }} ref={containerRef} />;
};

export default Page;
