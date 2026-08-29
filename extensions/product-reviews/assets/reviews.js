/**
 * KeepReviews storefront widget. Plain JS, no build step and no
 * third-party requests other than our own app proxy — everything the
 * widget needs (moderation status, plan-based display cap, widget colors)
 * is decided server-side and just rendered here.
 */
(function () {
  "use strict";

  function escapeHtml(value) {
    var div = document.createElement("div");
    div.textContent = value == null ? "" : String(value);
    return div.innerHTML;
  }

  function renderStars(rating) {
    var full = Math.max(0, Math.min(5, Math.round(rating)));
    return "★".repeat(full) + "☆".repeat(5 - full);
  }

  function renderReview(review) {
    var photos = (review.photoUrls || [])
      .map(function (url) {
        return (
          '<img class="keepreviews-photo" src="' +
          escapeHtml(url) +
          '" alt="Customer photo" loading="lazy">'
        );
      })
      .join("");

    return (
      '<article class="keepreviews-review">' +
      '<div class="keepreviews-stars">' +
      renderStars(review.rating) +
      "</div>" +
      '<p class="keepreviews-author">' +
      escapeHtml(review.authorName) +
      "</p>" +
      '<p class="keepreviews-body">' +
      escapeHtml(review.body) +
      "</p>" +
      (photos ? '<div class="keepreviews-photos">' + photos + "</div>" : "") +
      "</article>"
    );
  }

  var MAX_PHOTOS = 3;

  // Reads File objects as base64 data URLs. The server (not this code)
  // enforces the real size/type/plan limits — this is just how the bytes
  // get from an <input type="file"> into JSON.
  function readFilesAsDataUrls(files) {
    var limited = Array.prototype.slice.call(files, 0, MAX_PHOTOS);
    return Promise.all(
      limited.map(function (file) {
        return new Promise(function (resolve, reject) {
          var reader = new FileReader();
          reader.onload = function () {
            resolve(reader.result);
          };
          reader.onerror = reject;
          reader.readAsDataURL(file);
        });
      }),
    );
  }

  function renderForm(container, productId, productTitle, photosEnabled) {
    var form = document.createElement("form");
    form.className = "keepreviews-form";
    form.id = "keepreviews-write-a-review";
    form.innerHTML =
      '<h3>Write a review</h3>' +
      '<label>Rating' +
      '<select name="rating" required>' +
      '<option value="">Select a rating</option>' +
      [5, 4, 3, 2, 1]
        .map(function (n) {
          return '<option value="' + n + '">' + n + " stars</option>";
        })
        .join("") +
      "</select></label>" +
      '<label>Name<input type="text" name="authorName" required maxlength="200"></label>' +
      '<label>Email (optional)<input type="email" name="authorEmail"></label>' +
      '<label>Review<textarea name="body" required maxlength="5000"></textarea></label>' +
      (photosEnabled
        ? '<label>Photos (up to ' +
          MAX_PHOTOS +
          ')<input type="file" name="photos" accept="image/png,image/jpeg,image/webp" multiple></label>'
        : "") +
      '<button type="submit">Submit review</button>' +
      '<p class="keepreviews-form-status" role="status"></p>';

    form.addEventListener("submit", function (event) {
      event.preventDefault();
      var status = form.querySelector(".keepreviews-form-status");
      var submitButton = form.querySelector('button[type="submit"]');
      var formData = new FormData(form);
      var photoInput = form.querySelector('input[name="photos"]');
      var photoFiles = photoInput && photoInput.files ? photoInput.files : [];

      submitButton.disabled = true;
      status.textContent = "Submitting...";

      readFilesAsDataUrls(photoFiles)
        .then(function (photos) {
          return fetch("/apps/reviews/submit", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              productId: productId,
              productTitle: productTitle,
              rating: Number(formData.get("rating")),
              authorName: formData.get("authorName"),
              authorEmail: formData.get("authorEmail") || undefined,
              body: formData.get("body"),
              photos: photos,
            }),
          });
        })
        .then(function (response) {
          return response.json().then(function (data) {
            return { ok: response.ok, data: data };
          });
        })
        .then(function (result) {
          if (result.ok) {
            status.textContent =
              "Thanks! Your review was submitted and is awaiting approval.";
            form.reset();
          } else {
            status.textContent =
              (result.data && result.data.error) ||
              "Something went wrong. Please try again.";
          }
        })
        .catch(function () {
          status.textContent = "Network error. Please try again.";
        })
        .finally(function () {
          submitButton.disabled = false;
        });
    });

    container.appendChild(form);
  }

  function initWidget(container) {
    var productId = container.getAttribute("data-product-id");
    var productTitle = container.getAttribute("data-product-title");
    var layout = container.getAttribute("data-layout") || "grid";
    var heading = container.getAttribute("data-heading") || "Customer reviews";

    if (!productId) {
      container.innerHTML = "";
      return;
    }

    fetch(
      "/apps/reviews?product_id=" + encodeURIComponent(productId),
    )
      .then(function (response) {
        if (!response.ok) throw new Error("Request failed");
        return response.json();
      })
      .then(function (data) {
        var color = (data.widget && data.widget.primaryColor) || "#1A1A1A";
        container.style.setProperty("--keepreviews-color", color);
        container.classList.add("keepreviews-layout-" + layout);

        var summaryHtml =
          '<div class="keepreviews-summary">' +
          '<span class="keepreviews-stars">' +
          renderStars(data.averageRating) +
          "</span>" +
          '<span class="keepreviews-count">' +
          data.totalApprovedCount +
          " review" +
          (data.totalApprovedCount === 1 ? "" : "s") +
          "</span>" +
          "</div>";

        var listHtml = data.reviews.length
          ? '<div class="keepreviews-list">' +
            data.reviews.map(renderReview).join("") +
            "</div>"
          : '<p class="keepreviews-empty">No reviews yet. Be the first!</p>';

        container.innerHTML =
          "<h2>" + escapeHtml(heading) + "</h2>" + summaryHtml + listHtml;

        var photosEnabled = !!(data.widget && data.widget.photosEnabled);
        renderForm(container, productId, productTitle, photosEnabled);

        // Post-purchase review request emails link here with
        // ?keepreviews_review=1 so customers land straight on the form
        // instead of having to scroll and find it themselves.
        if (/[?&]keepreviews_review=1(&|$)/.test(window.location.search)) {
          var form = document.getElementById("keepreviews-write-a-review");
          if (form) {
            form.scrollIntoView({ behavior: "smooth", block: "start" });
          }
        }
      })
      .catch(function () {
        container.innerHTML =
          '<p class="keepreviews-error">Reviews are unavailable right now.</p>';
      });
  }

  function init() {
    var widgets = document.querySelectorAll("[data-keepreviews-widget]");
    widgets.forEach(initWidget);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
