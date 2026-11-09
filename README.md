# Audia

Audia is a web application prototype that uses AI to generate audio descriptions for videos, enhancing accessibility for visually impaired users. It leverages Google's Gemini models to analyze video content and generate descriptive text, which is then converted to speech using advanced Text-to-Speech (TTS) models.

> **Note:** This solution uses AI to edit or generate assets for your ads. Whether your content requires labeling depends on the nature of your assets, where your ads serve, and specific legal obligations that apply to you. In some circumstances Google may automatically apply a label. Please consult with your legal team to determine if/when a label is required for your ads. You can add labels in Google's Ads products using the [AI label setting](https://support.google.com/google-ads/answer/17140115).

## European Accessibility Act (EAA)

This solution can assist organizations in complying with the [European Accessibility Act (EAA)](https://eur-lex.europa.eu/eli/dir/2019/882/oj). The EAA requires certain products and services, including audiovisual media services, to be accessible to persons with disabilities. By automatically generating audio descriptions, this tool helps meet the requirement for making video content perceivable to users who are blind or have low vision.

# Getting Started

Copy `configuration.env.template` to `configuration.env` and configure your `GCP_PROJECT_ID`, `GCS_BUCKET_NAME`, regional settings, and the `IAP_MEMBERS` who may use the deployed app.

## Run locally
Run the server locally

```bash
bash run_local.sh
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

## Deploy

```sh
bash deploy.sh
```

The deployment script:

- Builds the container image in Cloud Build and pushes it to a dedicated regional Artifact Registry repository, with write access scoped to that repository for the project's default Cloud Build service account.
- Deploys to Cloud Run with `--no-allow-unauthenticated` behind Identity-Aware Proxy (IAP), grants `roles/run.invoker` to the IAP service agent, and grants IAP access only to the deploying user and the principals listed in `IAP_MEMBERS` (`allUsers` and `allAuthenticatedUsers` are rejected).
- Runs the service as a dedicated service account with `Vertex AI User` and `Logs Writer` on the project and `Storage Object Admin` only on `GCS_BUCKET_NAME`.
- Creates `GCS_BUCKET_NAME` if needed, with public access prevention and a lifecycle rule that deletes leftover uploads after one day. Uploaded videos are deleted right after analysis.

**Upgrading an existing deployment:** earlier versions granted `Storage Object Admin` on the whole project. `setup.sh` prints the command to remove that binding if it still exists.

## Security

Use a dedicated Google Cloud project or bucket for this solution, and only upload videos you have the rights to process. See [SECURITY.md](SECURITY.md) for how to report vulnerabilities.

## Disclaimer

Copyright Google LLC. Supported by Google LLC and/or its affiliate(s). This solution, including any related sample code or data, is made available on an "as is," "as available," and "with all faults" basis, solely for illustrative purposes, and without warranty or representation of any kind. This solution is experimental, unsupported and provided solely for your convenience. Your use of it is subject to your agreements with Google, as applicable, and may constitute a beta feature as defined under those agreements. To the extent that you make any data available to Google in connection with your use of the solution, you represent and warrant that you have all necessary and appropriate rights, consents and permissions to permit Google to use and process that data. By using any portion of this solution, you acknowledge, assume and accept all risks, known and unknown, associated with its usage and any processing of data by Google, including with respect to your deployment of any portion of this solution in your systems, or usage in connection with your business, if at all. In connection with this solution, you will not provide to Google any personally identifiable information, personal information or personal data.

This is not an official Google product.
