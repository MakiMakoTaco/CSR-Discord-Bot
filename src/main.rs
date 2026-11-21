use dotenv::dotenv;
use poise::serenity_prelude::{self as serenity, GuildId};
use sqlx::{Pool, Postgres, postgres::PgPoolOptions};

struct Data {
    pool: Pool<Postgres>,
}
type Error = Box<dyn std::error::Error + Send + Sync>;
type Context<'a> = poise::Context<'a, Data, Error>;

#[derive(sqlx::FromRow)]
pub struct Player {
    pub id: i16,
    pub name: String,
    pub discord_id: i64,
    pub name_color: String,
    pub random_uncleared: bool,
}

// #[derive(sqlx::FromRow)]
// pub struct Side {
//     pub id: i16,
//     pub name: String,
//     pub tiers: [Tier],
// }

// #[derive(sqlx::FromRow)]
// pub struct Tier {
//     pub id: i16,
//     pub name: String,
//     pub append_side_name: bool,
//     pub side_index: i8,
// }

// pub async fn create_db_connection() -> Pool<Postgres> {
//     let database_url = std::env::var("DATABASE_URL").expect("missing DATABASE_URL");

//     let pool = PgPoolOptions::new()
//         .max_connections(5)
//         .connect(&database_url)
//         .await
//         .expect("Failed to create pool.");

//     return pool;
// }

pub async fn get_player(pool: &sqlx::PgPool, discord_id: i64) -> Result<Player, sqlx::Error> {
    let player = sqlx::query_as::<_, Player>("SELECT * FROM players WHERE discord_id = $1")
        .bind(discord_id)
        .fetch_one(pool)
        .await?;

    Ok(player)
}

#[derive(sqlx::FromRow)]
pub struct Mod {
    pub id: i16,
    pub name: String,
}

pub async fn get_mods(pool: &sqlx::PgPool, player: Player) -> Result<Vec<Mod>, sqlx::Error> {
    let mods: Vec<Mod>;

    if player.random_uncleared {
        mods = sqlx::query_as::<_, Mod>(
            "
            SELECT
                id,
                name
            FROM mods
            WHERE id NOT IN (
                SELECT
                    mod_id
                FROM player_progress pp
                WHERE pp.player_id = $1
                AND pp.cleared = true
            )
        ",
        )
        .bind(player.id)
        .fetch_all(pool)
        .await?;
    } else {
        mods = sqlx::query_as::<_, Mod>(
            "
            SELECT
                id,
                name
            FROM mods
        ",
        )
        .bind(player.id)
        .fetch_all(pool)
        .await?;
    }

    Ok(mods)
}

#[poise::command(slash_command)]
async fn age(
    ctx: Context<'_>,
    #[description = "Selected user"] user: Option<serenity::User>,
) -> Result<(), Error> {
    let u = user.as_ref().unwrap_or_else(|| ctx.author());
    let response = format!("{}'s account was created at {}", u.name, u.created_at());
    ctx.say(response).await?;
    Ok(())
}

/// Gets a summary of your player data
#[poise::command(slash_command)]
async fn player(ctx: Context<'_>) -> Result<(), Error> {
    ctx.defer_ephemeral().await?;

    let discord_id = ctx.author().id.into();

    let pool = &ctx.data().pool;

    let player = get_player(&pool, discord_id).await.unwrap();
    println!("{:?}", player.random_uncleared);

    pool.close().await;

    let response = format!("Player name: {}", player.name);

    ctx.say(response).await?;
    Ok(())
}

async fn get_tiers(ctx: Context<'_>, partial: &str) -> serenity::CreateAutocompleteResponse {
    let sides = sqlx::query!(
        "SELECT
					s.id,
					s.name,
					json_agg(
						json_build_object(
							'id', t.id,
							'name', tp.name,
							'append_side_name', tp.append_side_name,
							'sideIndex', tp.side_index
						)
						ORDER BY tp.side_index
					) AS tiers
				FROM sides s
				LEFT JOIN tiers t
					ON t.side_id = s.id
				LEFT JOIN tier_presets tp
					ON tp.id = t.preset_id
				WHERE s.archived = false
				GROUP BY s.id
				ORDER BY lower(s.name)",
    )
    .fetch_all(&ctx.data().pool)
    .await
    .expect("No results");

    let filtered_tiers = sides
        .iter()
        .filter(|t| t.name.to_lowercase().contains(&partial.to_lowercase()))
        .take(25);

    let choices = filtered_tiers
        .map(|t| serenity::AutocompleteChoice::from(t.name.to_string()))
        .collect();

    serenity::CreateAutocompleteResponse::new().set_choices(choices)
}

#[poise::command(slash_command)]
async fn random_mod(
    ctx: Context<'_>,
    // #[description = "Tier to filter to"]
    // #[autocomplete = "get_tiers"]
    // filter: Option<String>,
) -> Result<(), Error> {
    ctx.defer_ephemeral().await?;

    let discord_id = ctx.author().id.into();
    let pool = &ctx.data().pool;
    let player = get_player(pool, discord_id).await.unwrap();
    println!("{:?}", player.id);
    let mods: Vec<Mod> = get_mods(pool, player).await?;

    println!("{:?}", mods.len());

    let random_mod = &mods[rand::random_range(..mods.len())];

    // println!("{:?}", random_mod[0].name);

    let response = format!("Chosen mod is {}", random_mod.name);

    ctx.say(response).await?;
    Ok(())
}

#[tokio::main]
async fn main() {
    dotenv().ok();

    let token = std::env::var("DISCORD_TOKEN").expect("missing DISCORD_TOKEN");

    let database_url = std::env::var("DATABASE_URL").expect("missing DATABASE_URL");
    let pool = PgPoolOptions::new()
        .max_connections(5)
        .connect(&database_url)
        .await
        .expect("Failed to create pool.");

    let intents = serenity::GatewayIntents::non_privileged();

    let framework = poise::Framework::builder()
        .options(poise::FrameworkOptions {
            commands: vec![age(), player(), random_mod()],
            ..Default::default()
        })
        .setup(|ctx, _ready, framework| {
            Box::pin(async move {
                poise::builtins::register_in_guild(
                    ctx,
                    &framework.options().commands,
                    GuildId::new(773124995684761630),
                )
                .await?;
                Ok(Data { pool: pool })
            })
        })
        .build();

    let client = serenity::ClientBuilder::new(token, intents)
        .framework(framework)
        .await;
    client.unwrap().start().await.unwrap();
}
