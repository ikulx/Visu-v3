// src/Page.js
import React, { useEffect, useState, useRef } from 'react';

const Page = ({ svg: svgName, properties }) => {
  const svgFile = `/assets/${svgName}.svg`;
  const [svgContent, setSvgContent] = useState('');
  const containerRef = useRef(null);

  useEffect(() => {
    fetch(svgFile)
      .then(response => {
        if (!response.ok) {
          throw new Error(`SVG-Datei ${svgFile} nicht gefunden.`);
        }
        return response.text();
      })
      .then(text => setSvgContent(text))
      .catch(err => console.error('Fehler beim Laden des SVG:', err));
  }, [svgFile]);

  useEffect(() => {
    if (svgContent && containerRef.current) {
      const parser = new DOMParser();
      const xmlDoc = parser.parseFromString(svgContent, "image/svg+xml");

      const ycontrol = xmlDoc.querySelector("ycontrol");
      if (ycontrol) {
        const propertyElements = ycontrol.querySelectorAll("property");
        propertyElements.forEach(propEl => {
          const propName = propEl.getAttribute("name");
          const value =
            properties && properties[propName]
              ? properties[propName].toString()
              : propEl.getAttribute("defaultvalue");

          const targets = propEl.querySelectorAll("target");
          targets.forEach(target => {
            const targetType = target.getAttribute("type");
            const targetElementName = target.getAttribute("element");
            let outputValue = null;
            const conditions = target.querySelectorAll("condition");
            for (let i = 0; i < conditions.length; i++) {
              const cond = conditions[i];
              if (cond.hasAttribute("eq")) {
                if (cond.getAttribute("eq") === value) {
                  outputValue = cond.getAttribute("output");
                  break;
                }
              } else if (cond.hasAttribute("lt")) {
                if (Number(value) < Number(cond.getAttribute("lt"))) {
                  outputValue = cond.getAttribute("output");
                  break;
                }
              } else if (cond.hasAttribute("gt")) {
                if (Number(value) > Number(cond.getAttribute("gt"))) {
                  outputValue = cond.getAttribute("output");
                  break;
                }
              } else if (cond.hasAttribute("lte")) {
                if (Number(value) <= Number(cond.getAttribute("lte"))) {
                  outputValue = cond.getAttribute("output");
                  break;
                }
              } else if (cond.hasAttribute("gte")) {
                if (Number(value) >= Number(cond.getAttribute("gte"))) {
                  outputValue = cond.getAttribute("output");
                  break;
                }
              }
            }

            if (outputValue !== null) {
              const svgElement = xmlDoc.querySelector("svg");
              if (svgElement) {
                const elementsToUpdate = svgElement.querySelectorAll(`.${targetElementName}`);
                if (targetType === "Style") {
                  const selector = target.getAttribute("selector");
                  elementsToUpdate.forEach(el => {
                    el.style[selector] = outputValue;
                  });
                } else if (targetType === "Content") {
                  elementsToUpdate.forEach(el => {
                    const tspan = el.querySelector("tspan");
                    if (tspan) {
                      tspan.textContent = outputValue;
                    } else {
                      el.textContent = outputValue;
                    }
                  });
                }
              }
            }
          });
        });
      }

      const svgEl = xmlDoc.querySelector("svg");
      if (svgEl) {
        if (!svgEl.getAttribute("viewBox")) {
          svgEl.setAttribute("viewBox", "0 0 262 122");
        }
        svgEl.removeAttribute("width");
        svgEl.removeAttribute("height");
        svgEl.setAttribute("width", "100%");
        svgEl.setAttribute("height", "100%");
        svgEl.setAttribute("preserveAspectRatio", "xMidYMid meet");
        svgEl.style.width = "100%";
        svgEl.style.height = "100%";
      }

      const updatedSvg = new XMLSerializer().serializeToString(xmlDoc);
      containerRef.current.innerHTML = updatedSvg;
    }
  }, [svgContent, properties]);

  return <div style={{ width: '100%', height: '100%' }} ref={containerRef} />;
};

export default Page;
